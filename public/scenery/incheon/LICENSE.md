# Incheon / Yeongjong scenery data

`source.osm.json.gz` is a frozen OpenStreetMap API response; `patch.json` is
an extracted, projected and clipped derivative database, not MIT-licensed code.
Both are distributed under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/

© OpenStreetMap contributors. Attribution and contributor information:
https://www.openstreetmap.org/copyright

The raw source, source URL, retrieval time, SHA-256 and offline transformation
are supplied in this directory and `scripts/scenery/build-incheon.mjs`.
No Google, VWorld or commercial imagery/model has been copied.

`coast-source.osm.json.gz`, `coastline.json` and `land-mask.png` are also
OpenStreetMap-derived data under ODbL 1.0, with the same attribution above.
The source requests, original response hashes and extract hash are in the
compressed coastline source and `terrain-metadata.json`.

`dressing.json` extracts additional parking outlines and an airport-boundary
planting exclusion from the same frozen OSM source. It is ODbL data as well.
Parking markings, facade patterns and tree placements are illustrative, not
surveyed features. The generated ground image retains OSM attribution.
Facade pattern code is original Flight3d code; the existing original MIT tree
geometry is reused from `src/environment/TreeModels.js`.

`regional-natural.bin` and `local-natural.bin` are resampled Copernicus DEM
GLO-30 surface heights. `local-graded.bin` additionally uses OSM footprints
for approximate model grading; preserve both sources' notices. These data
are not the repository's original MIT-licensed artwork.

produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA;
all rights reserved

Copernicus product and licence notices:
https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM

The natural source grids remain separate from the model grading. Neither
the building pads nor the airport reference are surveyed pavement data.

`src/config/incheonAirfield.json` is an ODbL derivative of the same frozen OSM
response, retaining complete runway/taxiway/apron ways instead of the 2km crop.
Rebuild with `node scripts/scenery/build-incheon-airfield.mjs`. Its source checksum
is recorded in the file. Runway markings and the constant 7m pavement profile are
illustrative model approximations, not surveyed or operational navigation data.
