import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import numpy as np
import io
import h5py
from pyproj import Proj
from api.smoke import components, smoke_quality, get_frame, key_time, decode, local_coverage, localities


class SmokeTests(unittest.TestCase):
    def test_san_luis_is_a_community_separate_from_landfill(self):
        site=next(p for p in localities() if p[0]=='San Luis')
        self.assertTrue(18.54 < site[1] < 18.58)
        self.assertTrue(-69.82 < site[2] < -69.78)

    def test_local_diagnostics_separate_cloud_quality_and_usable_negative(self):
        a=np.ones((1,1),dtype=bool);zero=np.zeros((1,1),dtype=np.int8)
        lon=np.array([[-69.7994]]);lat=np.array([[18.5591]])
        with patch('api.smoke.localities',return_value=[['San Luis',18.5591,-69.7994]]):
            cloudy=local_coverage(lon,lat,a,~a,~a,zero,a,zero,a)[0]
            invalid=local_coverage(lon,lat,a,~a,~a,zero,zero,zero,~a)[0]
            clear=local_coverage(lon,lat,a,a,~a,zero,zero,zero,a)[0]
        self.assertEqual(cloudy['referenceState'],'cloud');self.assertEqual(cloudy['usablePixels'],0)
        self.assertEqual(invalid['referenceState'],'invalid_quality')
        self.assertEqual(clear['referenceState'],'no_detection');self.assertEqual(clear['usablePixels'],1)

    def test_quality_rejects_low_and_bad(self):
        attrs = {"flag_meanings": b"high_confidence_smoke_detection_qf medium_confidence_smoke_detection_qf low_confidence_smoke_detection_qf bad_smoke_detection_qf",
                 "flag_masks": np.array([12]*4), "flag_values": np.array([0,4,8,12])}
        self.assertEqual(smoke_quality(np.array([0,4,8,12]),attrs).tolist(),[True,True,False,False])

    def test_components_do_not_merge_diagonal_pixels(self):
        self.assertEqual(sorted(map(len,components(np.array([[1,1,0],[0,0,1]],dtype=bool)))),[1,2])

    def test_bad_time_rejected_before_network(self):
        now=datetime(2026,9,8,16,tzinfo=timezone.utc)
        for value in ["bad", "2026-09-08T14:00", "2026-09-09T14:00Z", "2026-08-01T14:00Z"]:
            with self.assertRaises(ValueError): get_frame(value,now)

    def test_noaa_missing_is_not_no_smoke(self):
        with patch('api.smoke.read_url',return_value=b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>'):
            result=get_frame('2026-09-08T14:00Z',datetime(2026,9,8,16,tzinfo=timezone.utc))
        self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('components',result)

    def test_noaa_scan_timestamp(self):
        self.assertEqual(key_time('OR_ABI-L2-ADPF-M6_G19_s20262511500212_e20262511509520.nc').isoformat(),'2026-09-08T15:00:21+00:00')

    def test_netcdf_geolocation_and_cloud_dust_filter(self):
        buffer=io.BytesIO()
        attrs={'perspective_point_height':35786023.,'semi_major_axis':6378137.,'semi_minor_axis':6356752.31414,
               'longitude_of_projection_origin':-75.,'sweep_angle_axis':b'x'}
        projection=Proj(proj='geos',h=attrs['perspective_point_height'],lon_0=-75,a=attrs['semi_major_axis'],b=attrs['semi_minor_axis'],sweep='x')
        px,py=projection(-69.9,18.5)
        with h5py.File(buffer,'w') as f:
            f.create_dataset('goes_imager_projection',data=0).attrs.update(attrs)
            for name,center,sign in [('x',px,1),('y',py,-1)]:
                axis=f.create_dataset(name,data=center/attrs['perspective_point_height']+np.arange(-2,3)*sign*0.000056)
                axis.attrs.update({'scale_factor':1.,'add_offset':0.})
            for name in ['Smoke','Dust','Cloud']:
                f.create_dataset(name,data=np.zeros((5,5),dtype=np.int8))
            f['Smoke'][2,2]=1
            f['Smoke'][2,3]=1;f['Cloud'][2,3]=1
            f['Smoke'][3,2]=1;f['Dust'][3,2]=1
            dq=f.create_dataset('DQF',data=np.zeros((5,5),dtype=np.uint16))
            dq.attrs.update({'flag_meanings':b'high_confidence_smoke_detection_qf medium_confidence_smoke_detection_qf',
                             'flag_masks':np.array([12,12]),'flag_values':np.array([0,4])})
        result=decode(buffer.getvalue(),'OR_ABI-L2-ADPF-M6_G19_s20262511500212_e20262511509520.nc')
        self.assertEqual(len(result['mask']['features']),1)
        center=result['components'][0]['center']
        self.assertAlmostEqual(center[0],18.5,places=4);self.assertAlmostEqual(center[1],-69.9,places=4)
        self.assertGreater(result['components'][0]['areaKm2'],3)
        self.assertEqual(result['coverage']['ambiguousPixels'],1)


if __name__ == '__main__': unittest.main()
