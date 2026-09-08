"""NOAA GOES-19 ADP, cropped to Santo Domingo. No API key required."""
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, urlencode
from urllib.request import urlopen
import io
import json
import re
import xml.etree.ElementTree as ET
import h5py
import numpy as np
from pyproj import Proj, Geod

HOST = "https://noaa-goes19.s3.amazonaws.com/"
BBOX = [-70.4, 18.1, -69.2, 19.1]
UTC = timezone.utc


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


def smoke_quality(dqf, attrs):
    meanings = attrs["flag_meanings"]
    if isinstance(meanings, bytes):
        meanings = meanings.decode()
    names = meanings.split()
    accepted = np.zeros(dqf.shape, dtype=bool)
    for name in ("high_confidence_smoke_detection_qf", "medium_confidence_smoke_detection_qf"):
        i = names.index(name)  # Fail closed if the provider changes its flag schema.
        accepted |= (dqf & attrs["flag_masks"][i]) == attrs["flag_values"][i]
    return accepted


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
        # Densified boundary avoids missing curved projection extrema.
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
        quality = smoke_quality(f["DQF"][ys, xs], f["DQF"].attrs)
        usable = region & np.isin(smoke, [0, 1]) & (cloud == 0) & quality
        detected = usable & (smoke == 1) & (dust == 0)
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
                features.append({"type": "Feature", "properties": {"component": index},
                                 "geometry": {"type": "Polygon", "coordinates": [ring]}})
            rows, cols = zip(*group)
            summaries.append({"id": index, "center": [float(np.mean(lat[rows, cols])), float(np.mean(lon[rows, cols]))],
                              "areaKm2": round(area, 2), "cells": cells, "pixels": len(group)})
        total = int(region.sum())
        return {"status": "ok", "at": iso(key_time(key)), "scanEnd": iso(key_time(key, "e")),
                "source": HOST + key, "product": "GOES-19 ABI-L2-ADPF", "bbox": BBOX,
                "coverage": {"totalPixels": total, "usablePixels": int(usable.sum()),
                             "cloudPixels": int((region & (cloud == 1)).sum()),
                             "ambiguousPixels": int((usable & (smoke == 1) & (dust == 1)).sum()),
                             "usableFraction": round(int(usable.sum()) / max(total, 1), 3)},
                "components": summaries, "mask": {"type": "FeatureCollection", "features": features}}


def get_frame(value, now=None):
    now = now or datetime.now(UTC)
    try:
        requested = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise ValueError("Indica una hora ISO con zona horaria.")
    if requested.tzinfo is None:
        raise ValueError("Falta la zona horaria.")
    requested = requested.astimezone(UTC)
    if requested > now or requested < now - timedelta(days=8):
        raise ValueError("El análisis admite los últimos 8 días, sin fechas futuras.")
    slot = requested.replace(minute=requested.minute // 10 * 10, second=0, microsecond=0)
    prefix = slot.strftime("ABI-L2-ADPF/%Y/%j/%H/")
    listing = read_url(HOST + "?" + urlencode({"list-type": 2, "prefix": prefix, "max-keys": 100}), 500000)
    keys = [el.text for el in ET.fromstring(listing).iter() if el.tag.endswith("}Key")]
    keys = [key for key in keys if slot <= key_time(key) < slot + timedelta(minutes=10)]
    if not keys:
        return {"status": "unavailable", "requestedAt": iso(slot), "reason": "NOAA aún no publica esta escena o existe un hueco de observación."}
    key = sorted(keys)[-1]
    return decode(read_url(HOST + key, 20_000_000), key)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        code = 200
        try:
            value = parse_qs(urlparse(self.path).query).get("time", [""])[0]
            result = get_frame(value)
        except ValueError as error:
            code, result = 400, {"error": str(error)}
        except Exception:
            code, result = 502, {"error": "No se pudo procesar la escena NOAA. Reintenta; no implica ausencia de humo."}
        body = json.dumps(result, allow_nan=False, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, s-maxage=86400" if code == 200 and result.get("status") == "ok" else "no-store")
        self.end_headers()
        self.wfile.write(body)
