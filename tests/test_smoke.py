import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import numpy as np
import io
import h5py
from pyproj import Proj
from api.smoke import components, smoke_quality, smoke_confidence, angle_quality, get_frame, key_time, decode, local_coverage, localities, RequestError


class SmokeTests(unittest.TestCase):
    def test_san_luis_is_a_community_separate_from_landfill(self):
        site=next(p for p in localities() if p[0]=='San Luis')
        self.assertTrue(18.54 < site[1] < 18.58);self.assertTrue(-69.82 < site[2] < -69.78)

    def test_quality_decodes_confidence_but_top2_rejects_low_and_bad(self):
        attrs={"flag_meanings":b"high_confidence_smoke_detection_qf medium_confidence_smoke_detection_qf low_confidence_smoke_detection_qf bad_smoke_detection_qf","flag_masks":np.array([12]*4),"flag_values":np.array([0,4,8,12])}
        dqf=np.array([0,4,8,12],dtype=np.uint16);c=smoke_confidence(dqf,attrs)
        self.assertEqual(c['high'].tolist(),[True,False,False,False]);self.assertEqual(c['medium'].tolist(),[False,True,False,False]);self.assertEqual(c['low'].tolist(),[False,False,True,False]);self.assertEqual(c['bad'].tolist(),[False,False,False,True]);self.assertEqual(smoke_quality(dqf,attrs).tolist(),[True,True,False,False])

    def test_enterprise_angle_quality_uses_pqi1_not_smoke_confidence(self):
        invalid_sza,invalid_vza,schema=angle_quality(np.array([0,12,48,60],dtype=np.uint16),np.array([12,12,12,12],dtype=np.uint16))
        self.assertEqual(schema,'enterprise');self.assertEqual(invalid_sza.tolist(),[False,True,False,True]);self.assertEqual(invalid_vza.tolist(),[False,False,True,True])

    def test_local_diagnostics_separate_observability_and_detection_confidence(self):
        a=np.ones((1,1),dtype=bool);z=np.zeros((1,1),dtype=np.int8);lon=np.array([[-69.7994]]);lat=np.array([[18.5591]])
        conf={'high':a,'medium':~a,'low':~a,'bad':~a}
        with patch('api.smoke.localities',return_value=[['San Luis',18.5591,-69.7994]]):
            clear=local_coverage(lon,lat,a,a,~a,~a,z,z,z,z,~a,~a,~a,conf)[0]
            low=local_coverage(lon,lat,a,a,~a,a,np.ones((1,1),dtype=np.int8),z,z,z,~a,~a,~a,{**conf,'high':~a,'low':a})[0]
            angle=local_coverage(lon,lat,a,~a,~a,~a,z,z,z,z,a,~a,~a,conf)[0]
        self.assertEqual(clear['referenceState'],'no_detection');self.assertEqual(clear['usablePixels'],1)
        self.assertEqual(low['referenceState'],'low_confidence_smoke');self.assertEqual(low['usablePixels'],1)
        self.assertEqual(angle['referenceState'],'invalid_sza');self.assertEqual(angle['usablePixels'],0)

    def test_components_do_not_merge_diagonal_pixels(self):
        self.assertEqual(sorted(map(len,components(np.array([[1,1,0],[0,0,1]],dtype=bool)))),[1,2])

    def test_bad_or_future_time_rejected_before_network(self):
        now=datetime(2026,9,8,16,tzinfo=timezone.utc)
        for value in ["bad", "2026-09-08T14:00", "2026-09-09T14:00Z"]:
            with self.assertRaises(RequestError): get_frame(value,now)

    def test_historical_time_is_allowed_and_missing_archive_is_unavailable(self):
        xml=b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>'
        with patch('api.smoke.read_url',return_value=xml):
            result=get_frame('2026-08-01T14:00Z',datetime(2026,9,8,16,tzinfo=timezone.utc))
        self.assertEqual(result['status'],'unavailable');self.assertIn('requestedAt',result)

    def test_noaa_missing_is_not_no_smoke(self):
        with patch('api.smoke.read_url',return_value=b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>'):
            result=get_frame('2026-09-08T14:00Z',datetime(2026,9,8,16,tzinfo=timezone.utc))
        self.assertEqual(result['status'],'unavailable');self.assertNotIn('components',result)

    def test_noaa_scan_timestamp(self):
        self.assertEqual(key_time('OR_ABI-L2-ADPF-M6_G19_s20262511500212_e20262511509520.nc').isoformat(),'2026-09-08T15:00:21+00:00')

    def test_netcdf_observability_is_not_top2_confidence(self):
        buffer=io.BytesIO();attrs={'perspective_point_height':35786023.,'semi_major_axis':6378137.,'semi_minor_axis':6356752.31414,'longitude_of_projection_origin':-75.,'sweep_angle_axis':b'x'}
        projection=Proj(proj='geos',h=attrs['perspective_point_height'],lon_0=-75,a=attrs['semi_major_axis'],b=attrs['semi_minor_axis'],sweep='x');px,py=projection(-69.9,18.5)
        with h5py.File(buffer,'w') as f:
            f.create_dataset('goes_imager_projection',data=0).attrs.update(attrs)
            for name,center,sign in [('x',px,1),('y',py,-1)]:
                axis=f.create_dataset(name,data=center/attrs['perspective_point_height']+np.arange(-2,3)*sign*0.000056);axis.attrs.update({'scale_factor':1.,'add_offset':0.})
            for name in ['Smoke','Dust','Cloud','SnowIce']:
                f.create_dataset(name,data=np.zeros((5,5),dtype=np.int8))
            f['Smoke'][2,2]=1;f['Smoke'][2,3]=1;f['Cloud'][2,3]=1;f['Smoke'][3,2]=1;f['Dust'][3,2]=1;f['Smoke'][1,2]=1
            dq=f.create_dataset('DQF',data=np.zeros((5,5),dtype=np.uint16));dq[1,2]=8
            dq.attrs.update({'flag_meanings':b'high_confidence_smoke_detection_qf medium_confidence_smoke_detection_qf low_confidence_smoke_detection_qf bad_smoke_detection_qf','flag_masks':np.array([12,12,12,12]),'flag_values':np.array([0,4,8,12])})
            pqi=f.create_dataset('PQI1',data=np.zeros((5,5),dtype=np.uint16));pqi[0,0]=12
        result=decode(buffer.getvalue(),'OR_ABI-L2-ADPF-M6_G19_s20262511500212_e20262511509520.nc')
        self.assertEqual(len(result['mask']['features']),1);self.assertGreater(result['coverage']['usablePixels'],0);self.assertEqual(result['coverage']['lowConfidenceDetectedPixels'],1);self.assertEqual(result['coverage']['ambiguousPixels'],1);self.assertGreater(result['coverage']['invalidSzaPixels'],0);self.assertEqual(result['qualityModel']['primarySmoke'],'high+medium')
        center=result['components'][0]['center'];self.assertAlmostEqual(center[0],18.5,places=4);self.assertAlmostEqual(center[1],-69.9,places=4)


if __name__ == '__main__': unittest.main()
