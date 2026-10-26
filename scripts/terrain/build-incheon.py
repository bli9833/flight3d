"""Build the stage-two terrain/coast assets. See incheon-scenery.md for limits.

Uses the same WGS84 east/south tangent plane as src/geospatial/incheon.js.
The DSM stays unchanged in natural grids; model grading is a separate grid.
"""
from pathlib import Path
from urllib.request import urlopen
import gzip
import hashlib
import json
import math

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from pyproj import Transformer, enums
from shapely import contains_xy, distance, points
from shapely.geometry import LineString, Polygon, box, mapping
from shapely.ops import polygonize_full, unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/scenery/incheon'
CACHE = ROOT / '.cache/terrain'
TILE = 'Copernicus_DSM_COG_10_N37_00_E126_00_DEM'
URL = f'https://copernicus-dem-30m.s3.amazonaws.com/{TILE}/{TILE}.tif'
SHA = 'f530dd28308ecd6c5ceb0405dc1ffb7113bcafdec30d023de50f16dc433a274f'
COAST_SHA = 'de8110a39194d447f76576749dd7866d356ccf1c1800aceca1f8ef995c91ecbc'
LAT, LON, SIZE, GRID, LOCAL_SIZE, LOCAL_GRID = 37.448, 126.455, 12000, 401, 2000, 161
FRAME = Transformer.from_pipeline(
    f'+proj=pipeline +step +proj=cart +ellps=WGS84 +step +proj=topocentric '
    f'+ellps=WGS84 +lat_0={LAT} +lon_0={LON} +h_0=0')
NOTICE = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence '
          'and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved')


def local(lon, lat):
    east, north, _ = FRAME.transform(lon, lat, 0)
    return round(east, 2), round(-north, 2)


def lonlat(x, z):
    # Inverse at up=0 differs from the ellipsoid-surface tangent projection by
    # <0.01m horizontally at these extents (verified in metadata checkpoints).
    lon, lat, _ = FRAME.transform(x, -z, np.zeros_like(x), direction=enums.TransformDirection.INVERSE)
    return lon, lat


def smooth(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def load_dem():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / 'copernicus-n37-e126.tif'
    if not path.exists():
        with urlopen(URL, timeout=90) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != SHA:
            raise ValueError('Downloaded DEM checksum mismatch')
        path.write_bytes(data)
    if hashlib.sha256(path.read_bytes()).hexdigest() != SHA:
        raise ValueError('Cached DEM checksum mismatch')
    return path


def sampler(path):
    with rasterio.open(path) as dataset:
        pixels = dataset.read(1)
        transform = dataset.transform
        if dataset.crs.to_epsg() != 4326 or not np.isfinite(pixels).all():
            raise ValueError('Unexpected DEM CRS or missing samples')

    def sample(x, z):
        lon, lat = lonlat(np.asarray(x), np.asarray(z))
        col, row = (~transform) * (lon, lat)
        col, row = col - .5, row - .5
        ix, iy = np.floor(col).astype(int), np.floor(row).astype(int)
        if np.any(ix < 0) or np.any(iy < 0) or np.any(ix + 1 >= pixels.shape[1]) or np.any(iy + 1 >= pixels.shape[0]):
            raise ValueError('Sample outside source DEM')
        fx, fy = col - ix, row - iy
        return (pixels[iy, ix] * (1-fx) * (1-fy) + pixels[iy, ix+1] * fx * (1-fy)
                + pixels[iy+1, ix] * (1-fx) * fy + pixels[iy+1, ix+1] * fx * fy)
    return sample


def coastline():
    raw = gzip.decompress((OUT / 'coast-source.osm.json.gz').read_bytes())
    if hashlib.sha256(raw).hexdigest() != COAST_SHA:
        raise ValueError('Coast source checksum mismatch')
    source = json.loads(raw)
    nodes = {e['id']: e for e in source['elements'] if e['type'] == 'node'}
    region = box(-SIZE/2, -SIZE/2, SIZE/2, SIZE/2)
    lines = []
    segments = []
    source_ids = []
    for way in source['elements']:
        if way['type'] != 'way':
            continue
        if any(n not in nodes for n in way['nodes']):
            raise ValueError('Missing coastline node')
        coords = [local(nodes[n]['lon'], nodes[n]['lat']) for n in way['nodes']]
        line = LineString(coords).intersection(region)
        if line.is_empty:
            continue
        source_ids.append(f"way/{way['id']}")
        for part in line.geoms if line.geom_type == 'MultiLineString' else [line]:
            lines.append(part)
            for a, b in zip(part.coords, list(part.coords)[1:]):
                segments.append((a, b))
    network = unary_union([region.boundary, *lines])
    faces, cuts, dangles, invalid = polygonize_full(network)
    if cuts.length > .01 or dangles.length > .01 or not invalid.is_empty:
        raise ValueError('Incomplete coastline topology; refuse invented closure')
    if len(faces.geoms) < 2:
        raise ValueError('Coastline did not divide regional land/water')
    starts = np.array([a for a, _ in segments])
    delta = np.array([b for _, b in segments]) - starts
    lengths = (delta * delta).sum(axis=1)
    land_faces = []
    for face in faces.geoms:
        point = np.array(face.representative_point().coords[0])
        t = np.clip(((point - starts) * delta).sum(axis=1) / lengths, 0, 1)
        nearest = starts + t[:, None] * delta
        i = np.argmin(((nearest - point) ** 2).sum(axis=1))
        offset = point - starts[i]
        cross = delta[i, 0] * offset[1] - delta[i, 1] * offset[0]
        # OSM: land left in east/north; with +Z south the cross sign reverses.
        if cross < 0:
            land_faces.append(face)
    land = unary_union(land_faces)
    if land.is_empty or not land.is_valid:
        raise ValueError('Invalid land polygon')
    checks = []
    for name, lon, lat, expected in [('T1 airport land', 126.455, 37.448, True),
                                    ('southwest sea', 126.397, 37.403, False),
                                    ('northeast land', 126.50, 37.49, True)]:
        x, z = local(lon, lat)
        observed = bool(contains_xy(land, x, z))
        if observed != expected:
            raise ValueError(f'Coast land-side check failed: {name}')
        checks.append(dict(name=name, longitude=lon, latitude=lat, x=x, z=z, land=observed))
    return land, lines, dict(sourceSha256=COAST_SHA, sourceWayIds=source_ids,
                            requests=source['requests'], faceCount=len(faces.geoms), checkpoints=checks)


def main():
    sample = sampler(load_dem())
    land, coast_lines, coast_meta = coastline()
    patch = json.loads((OUT / 'patch.json').read_bytes())
    if patch['origin'] != dict(latitude=LAT, longitude=LON) or patch['halfSizeMeters'] != LOCAL_SIZE / 2:
        raise ValueError('Patch and terrain coordinate frames differ')
    regional_axis = np.linspace(-SIZE/2, SIZE/2, GRID)
    rx, rz = np.meshgrid(regional_axis, regional_axis)
    regional = sample(rx, rz).astype('<f4')
    local_axis = np.linspace(-LOCAL_SIZE/2, LOCAL_SIZE/2, LOCAL_GRID)
    x, z = np.meshgrid(local_axis, local_axis)
    natural = sample(x, z).astype('<f4')
    terrain = natural.astype(float).copy()
    point_grid = points(x, z)
    edge_weight = smooth((1000 - np.maximum(np.abs(x), np.abs(z))) / 80)
    airport_polygons = []
    buildings = []
    for feature in patch['features']:
        for part in feature['parts']:
            if feature['kind'] == 'building':
                polygon = Polygon(part)
                if not polygon.is_valid:
                    raise ValueError('Invalid building footprint')
                buildings.append((feature, polygon))
                if feature['id'] == 'relation/3917466':
                    airport_polygons.append(polygon.buffer(20))
            elif feature['kind'] == 'apron':
                airport_polygons.append(Polygon(part))
            elif feature['kind'] in ['runway', 'taxiway']:
                airport_polygons.append(LineString(part).buffer(40 if feature['kind'] == 'runway' else 20))
    airport = unary_union(airport_polygons)
    airport_weight = (1 - smooth(distance(point_grid, airport) / 80)) * edge_weight
    terrain = terrain * (1 - airport_weight) + 7 * airport_weight
    all_buildings = unary_union([p for _, p in buildings])
    pads = []
    for feature, polygon in buildings:
        if feature['id'] == 'relation/3917466':
            base = 7.0
        else:
            # Roof/surface imprint removal is an explicit modeling approximation:
            # lower-quintile DSM around the footprint, excluding other buildings.
            minx, minz, maxx, maxz = polygon.buffer(35).bounds
            bx, bz = np.meshgrid(np.arange(minx, maxx + 5, 5), np.arange(minz, maxz + 5, 5))
            ring = polygon.buffer(35).difference(all_buildings.buffer(5))
            valid = contains_xy(ring, bx, bz)
            if not valid.any():
                raise ValueError('No ground-reference samples around building')
            base = float(np.percentile(sample(bx[valid], bz[valid]), 20))
        weight = (1 - smooth(distance(point_grid, polygon.buffer(15)) / 15)) * edge_weight
        terrain = terrain * (1 - weight) + base * weight
        pads.append(dict(id=feature['id'], baseM=round(base, 3), reason='airport-reference' if base == 7 else 'surrounding-DSM-p20'))
    terrain = terrain.astype('<f4')
    mask = rasterize([(mapping(land), 255)], out_shape=(1024, 1024),
                     transform=from_bounds(-SIZE/2, SIZE/2, SIZE/2, -SIZE/2, 1024, 1024), dtype='uint8')
    with rasterio.open(OUT / 'land-mask.png', 'w', driver='PNG', width=1024, height=1024, count=1, dtype='uint8') as image:
        image.write(mask, 1)
    grids = {}
    for name, array, size in [('regional-natural', regional, SIZE), ('local-natural', natural, LOCAL_SIZE), ('local-graded', terrain, LOCAL_SIZE)]:
        binary = array.tobytes()
        (OUT / f'{name}.bin').write_bytes(binary)
        grids[name] = dict(file=f'{name}.bin', gridSize=array.shape[0], worldSize=size,
                           spacingM=size/(array.shape[0]-1), sha256=hashlib.sha256(binary).hexdigest(),
                           minM=float(array.min()), maxM=float(array.max()))
    (OUT / 'coastline.json').write_text(json.dumps(dict(
        lines=[list(line.coords) for line in coast_lines], land=mapping(land)), separators=(',', ':')) + '\n')
    checkpoints = []
    for row, col in [(200, 200), (40, 40), (100, 300), (300, 100), (360, 360)]:
        cx, cz = float(rx[row, col]), float(rz[row, col])
        lon, lat = lonlat(cx, cz)
        back = local(lon, lat)
        checkpoints.append(dict(x=cx, z=cz, longitude=float(lon), latitude=float(lat),
                                heightM=float(regional[row, col]), roundTripErrorM=math.hypot(back[0]-cx, back[1]-cz)))
    metadata = dict(schemaVersion=1, origin=patch['origin'], axes='+X east, +Z south; rows north to south; Float32 little-endian',
        horizontalFrame='WGS84 ellipsoid ECEF -> local east/north tangent plane; Z=-north',
        verticalDatum='EGM2008 orthometric meters (Copernicus DSM); modeled sea level Y=0, no tides',
        dem=dict(dataset='Copernicus GLO-30 DSM', url=URL, sourceSha256=SHA, sourceSpacingArcSec=1,
                 resampling='bilinear at local-grid node coordinates', attribution=NOTICE, checkpoints=checkpoints),
        coast=coast_meta, grids=grids, mask=dict(file='land-mask.png', pixels=1024, pixelSizeM=SIZE/1024),
        grading=dict(patchSha256=hashlib.sha256((OUT / 'patch.json').read_bytes()).hexdigest(),
                     airportReferenceM=7, airportReferenceSource='https://aim.koca.go.kr/eaipPub/Package/2026-06-25/html/eAIP/KR-AD-2.RKSI-en-GB.html',
                     airportReferenceNote='AD 2.2 aerodrome elevation is a reference, NOT surveyed elevations of every apron or threshold',
                     airportBlendM=80, localEdgeBlendM=80, buildingPads=pads,
                     note='Preview model grading only; natural grids are retained unmodified. Building reference is DSM lower quintile around footprint, not a DTM.',
                     changedSamples=int(np.count_nonzero(np.abs(terrain-natural) > .01)), maxDeltaM=float(np.max(np.abs(terrain-natural)))),
        limitations=['12km western airport region, not all Yeongjong', 'Buildings/roads remain the original central 2km patch',
                     'DSM includes buildings/vegetation; grading is an approximation, not surveyed airport pavement',
                     'Coastline OSM epoch differs from DSM; mask resolution 11.72m; no bathymetry or tides',
                     'Bridge/tunnel clearances and flight/collision integration are not implemented'])
    for filename in ['land-mask.png', 'coastline.json']:
        metadata.setdefault('assetSha256', {})[filename] = hashlib.sha256((OUT / filename).read_bytes()).hexdigest()
    (OUT / 'terrain-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(grids=grids, grading=metadata['grading']['changedSamples'], coastFaces=coast_meta['faceCount']), indent=2))


if __name__ == '__main__':
    main()
