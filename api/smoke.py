"""NOAA GOES-19 ADP, cropped to Santo Domingo. No API key required."""
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, urlencode
from urllib.request import urlopen
import io
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from functools import lru_cache
import h5py
import numpy as np
from pyproj import Proj, Geod

HOST = "https://noaa-goes19.s3.amazonaws.com/"
BBOX = [-70.4, 18.1, -69.2, 19.1]
UTC = timezone.utc


class RequestError(ValueError):
    """Bad user input. Provider/schema errors must not be reported as HTTP 400."""


@lru_cache(maxsize=1)
def localities():
    return json.loads((Path(__file__).resolve().parent.parent / "dist/localities.json").read_text())


def _flag(dqf, attrs, name):
    meanings = attrs["flag_meanings"]
    if isinstance(meanings, bytes):
        meanings = meanings.decode()
    names = meanings.split()
    i = names.index(name)  # Fail closed if NOAA changes the documented schema.
    return (dqf & attrs["flag_masks"][i]) == attrs["flag_values"][i]


def smoke_confidence(dqf, attrs):
    """Decode smoke confidence only; it is not an observability mask."""
    high = _flag(dqf, attrs, "high_confidence_smoke_detection_qf")
    medium = _flag(dqf, attrs, "medium_confidence_smoke_detection_qf")
    low = _flag(dqf, attrs, "low_confidence_smoke_detection_qf")
    bad = ~(high | medium | low)
    return {"high": high, "medium": medium, "low": low, "bad": bad}


def smoke_quality(dqf, attrs):
    """Backward-compatible Top-2 (high + medium) smoke-confidence mask."""
    confidence = smoke_confidence(dqf, attrs)
    return confidence["high"] | confidence["medium"]


def angle_quality(pqi1, dqf=None):
    """Return invalid SZA/VZA masks for Enterprise ADP; baseline fallback is explicit."""
    if pqi1 is not None:
        return (pqi1 & 12) == 12, (pqi1 & 48) == 48, "enterprise"
    if dqf is None:
        raise ValueError("El archivo NOAA no contiene PQI1 ni DQF para validar geometría.")
    invalid = (dqf & 128) == 128
    return invalid, invalid, "baseline-fallback"


def local_coverage(lon, lat, region, observable, detected, low_detected, smoke, cloud, dust,
                   snow_ice, invalid_sza, invalid_vza, invalid_quality, confidence):
    """Report observability independently from smoke-detection confidence."""
    geod = Geod(ellps="WGS84")
    result = []
    for name, point_lat, point_lon in localities():
        _, _, meters = geod.inv(np.full(lon.shape, point_lon), np.full(lat.shape, point_lat), lon, lat)
        area = region & (meters <= 3000)
        count = int(area.sum())
        nearest = np.unravel_index(np.argmin(np.where(region, meters, np.inf)), lon.shape)
        if not count:
            state = "outside"
        elif cloud[nearest] == 1:
            state = "cloud"
        elif snow_ice[nearest] == 1:
            state = "snow_ice"
        elif invalid_sza[nearest]:
            state = "invalid_sza"
        elif invalid_vza[nearest]:
            state = "invalid_vza"
        elif invalid_quality[nearest] or smoke[nearest] not in (0, 1):
            state = "invalid_quality"
        elif smoke[nearest] == 1 and dust[nearest] == 1:
            state = "ambiguous"
        elif detected[nearest]:
            state = "smoke"
        elif low_detected[nearest]:
            state = "low_confidence_smoke"
        elif observable[nearest]:
            state = "no_detection"
        else:
            state = "unavailable"
        result.append({
            "name": name, "center": [point_lat, point_lon], "radiusKm": 3,
            "totalPixels": count,
            "usablePixels": int((area & observable).sum()),
            "observablePixels": int((area & observable).sum()),
            "detectedPixels": int((area & detected).sum()),
            "lowConfidenceDetectedPixels": int((area & low_detected).sum()),
            "cloudPixels": int((area & (cloud == 1)).sum()),
            "snowIcePixels": int((area & (snow_ice == 1)).sum()),
            "invalidSzaPixels": int((area & invalid_sza).sum()),
            "invalidVzaPixels": int((area & invalid_vza).sum()),
            "invalidQualityPixels": int((area & invalid_quality).sum()),
            "ambiguousPixels": int((area & observable & (smoke == 1) & (dust == 1)).sum()),
            "rawSmokePixels": int((area & observable & (smoke == 1)).sum()),
            "highConfidenceSmokePixels": int((area & observable & (smoke == 1) & confidence["high"]).sum()),
            "mediumConfidenceSmokePixels": int((area & observable & (smoke == 1) & confidence["medium"]).sum()),
            "lowConfidenceSmokePixels": int((area & observable & (smoke == 1) & confidence["low"]).sum()),
            "usableFraction": round(int((area & observable).sum()) / max(count, 1), 3),
            "referenceState": state,
        })
    return result


def read_url(url, limit):
    with urlopen(url, timeout=22) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError("El archivo del proveedor supera el límite de procesamiento.")
    return body


def iso(t):
    return t.isoformat().replace("+00:00", "Z")


def key_time(key, tag="s"):
    value = re.search(r"_" + tag + r"(\d{13})", key)
    if not value:
        raise ValueError("Fecha NOAA no reconocida.")
    return datetime.strptime(value[1], "%Y%j%H%M%S").replace(tzinfo=UTC)


def components(mask):
    remaining = set(map(tuple, np.argwhere(mask)))
    groups = []
    while remaining:
        point = min(remaining)
        remaining.remove(point)
        group, queue = [point], [point]
        while queue:
            y, x = queue.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                neighbor = (y + dy, x + dx)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
                    group.append(neighbor)
        groups.append(group)
    return groups


def decode(body, key):
    with h5py.File(io.BytesIO(body), "r") as f:
        attrs = f["goes_imager_projection"].attrs
        height = float(attrs["perspective_point_height"])
        sweep = attrs["sweep_angle_axis"]
        if isinstance(sweep, bytes):
            sweep = sweep.decode()
        projection = Proj(proj="geos", h=height, lon_0=float(attrs["longitude_of_projection_origin"]),
                          a=float(attrs["semi_major_axis"]), b=float(attrs["semi_minor_axis"]), sweep=sweep)

        def axis(name):
            dataset = f[name]
            return dataset[:].astype(float) * dataset.attrs["scale_factor"] + dataset.attrs["add_offset"]

        x, y = axis("x"), axis("y")
        west, south, east, north = BBOX
        lo = np.concatenate([np.linspace(west, east, 40)] * 2 + [np.full(40, west), np.full(40, east)])
        la = np.concatenate([np.full(40, south), np.full(40, north)] + [np.linspace(south, north, 40)] * 2)
        xx, yy = projection(lo, la)
        xi = np.where((x >= min(xx) / height - abs(x[1]-x[0])) & (x <= max(xx) / height + abs(x[1]-x[0])))[0]
        yi = np.where((y >= min(yy) / height - abs(y[1]-y[0])) & (y <= max(yy) / height + abs(y[1]-y[0])))[0]
        if not len(xi) or not len(yi):
            raise ValueError("La proyección no cubre Santo Domingo.")
        xs, ys = slice(int(xi.min()), int(xi.max())+1), slice(int(yi.min()), int(yi.max())+1)
        gx, gy = np.meshgrid(x[xs], y[ys])
        lon, lat = projection(gx * height, gy * height, inverse=True)
        region = (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
        smoke, cloud, dust = (f[name][ys, xs] for name in ("Smoke", "Cloud", "Dust"))
        snow_ice = f["SnowIce"][ys, xs] if "SnowIce" in f else np.zeros(smoke.shape, dtype=np.int8)
        dqf = f["DQF"][ys, xs]
        confidence = smoke_confidence(dqf, f["DQF"].attrs)
        pqi1 = f["PQI1"][ys, xs] if "PQI1" in f else None
        invalid_sza, invalid_vza, geometry_schema = angle_quality(pqi1, dqf)
        invalid_quality = confidence["bad"] | ~np.isin(smoke, [0, 1])

        observable = (region & np.isin(smoke, [0, 1]) & (cloud == 0) & (snow_ice == 0)
                      & ~invalid_sza & ~invalid_vza & ~invalid_quality)
        raw_smoke = observable & (smoke == 1)
        top2 = confidence["high"] | confidence["medium"]
        detected = raw_smoke & top2 & (dust == 0)
        low_detected = raw_smoke & confidence["low"] & (dust == 0)
        groups = components(detected)

        dx, dy = abs(float(x[1]-x[0])) / 2, abs(float(y[1]-y[0])) / 2
        geod = Geod(ellps="WGS84")
        features, summaries = [], []
        for index, group in enumerate(groups):
            area = 0
            cells = []
            for row, col in group:
                cx, cy = gx[row, col], gy[row, col]
                px = np.array([cx-dx, cx+dx, cx+dx, cx-dx, cx-dx]) * height
                py = np.array([cy-dy, cy-dy, cy+dy, cy+dy, cy-dy]) * height
                plon, plat = projection(px, py, inverse=True)
                ring = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(plon, plat)]
                pixel_area = abs(geod.polygon_area_perimeter(plon, plat)[0]) / 1e6
                area += pixel_area
                cells.append(f"{int(yi.min())+row}:{int(xi.min())+col}")
                features.append({"type": "Feature", "properties": {"component": index, "confidence": "top2"},
                                 "geometry": {"type": "Polygon", "coordinates": [ring]}})
            rows, cols = zip(*group)
            summaries.append({"id": index, "center": [float(np.mean(lat[rows, cols])), float(np.mean(lon[rows, cols]))],
                              "areaKm2": round(area, 2), "cells": cells, "pixels": len(group)})

        total = int(region.sum())
        coverage = {
            "totalPixels": total,
            "usablePixels": int(observable.sum()),
            "observablePixels": int(observable.sum()),
            "cloudPixels": int((region & (cloud == 1)).sum()),
            "snowIcePixels": int((region & (snow_ice == 1)).sum()),
            "invalidSzaPixels": int((region & invalid_sza).sum()),
            "invalidVzaPixels": int((region & invalid_vza).sum()),
            "invalidQualityPixels": int((region & invalid_quality).sum()),
            "rawSmokePixels": int(raw_smoke.sum()),
            "highConfidenceSmokePixels": int((raw_smoke & confidence["high"]).sum()),
            "mediumConfidenceSmokePixels": int((raw_smoke & confidence["medium"]).sum()),
            "lowConfidenceSmokePixels": int((raw_smoke & confidence["low"]).sum()),
            "lowConfidenceDetectedPixels": int(low_detected.sum()),
            "ambiguousPixels": int((raw_smoke & (dust == 1)).sum()),
            "usableFraction": round(int(observable.sum()) / max(total, 1), 3),
        }
        return {
            "status": "ok", "at": iso(key_time(key)), "scanEnd": iso(key_time(key, "e")),
            "source": HOST + key, "product": "GOES-19 ABI-L2-ADPF", "bbox": BBOX,
            "qualityModel": {"geometry": geometry_schema, "primarySmoke": "high+medium", "secondarySmoke": "low"},
            "coverage": coverage,
            "localities": local_coverage(lon, lat, region, observable, detected, low_detected, smoke, cloud, dust,
                                         snow_ice, invalid_sza, invalid_vza, invalid_quality, confidence),
            "components": summaries, "mask": {"type": "FeatureCollection", "features": features},
        }


def get_frame(value, now=None):
    now = now or datetime.now(UTC)
    try:
        requested = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise RequestError("Indica una hora ISO con zona horaria.")
    if requested.tzinfo is None:
        raise RequestError("Falta la zona horaria.")
    requested = requested.astimezone(UTC)
    if requested > now:
        raise RequestError("No se pueden analizar fechas futuras.")
    slot = requested.replace(minute=requested.minute // 10 * 10, second=0, microsecond=0)
    prefix = slot.strftime("ABI-L2-ADPF/%Y/%j/%H/")
    listing = read_url(HOST + "?" + urlencode({"list-type": 2, "prefix": prefix, "max-keys": 100}), 500000)
    keys = [el.text for el in ET.fromstring(listing).iter() if el.tag.endswith("}Key")]
    keys = [key for key in keys if slot <= key_time(key) < slot + timedelta(minutes=10)]
    if not keys:
        return {"status": "unavailable", "requestedAt": iso(slot), "reason": "NOAA no publica una escena ADP para esa hora o existe un hueco de observación. En fechas anteriores a la disponibilidad de GOES-19 esto es esperado."}
    key = sorted(keys)[-1]
    return decode(read_url(HOST + key, 20_000_000), key)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        code = 200
        try:
            value = parse_qs(urlparse(self.path).query).get("time", [""])[0]
            result = get_frame(value)
        except RequestError as error:
            code, result = 400, {"error": str(error)}
        except Exception as error:
            print(json.dumps({"event": "smoke_processing_error", "type": type(error).__name__}), flush=True)
            code, result = 502, {"error": "No se pudo procesar la escena NOAA. Reintenta; no implica ausencia de humo."}
        body = json.dumps(result, allow_nan=False, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, s-maxage=86400" if code == 200 and result.get("status") == "ok" else "no-store")
        self.end_headers()
        self.wfile.write(body)
