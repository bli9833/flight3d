# Pavement textures

Six original 1024px JPEG maps from Poly Haven, by **Rob Tuytel**:

- [Asphalt 02](https://polyhaven.com/a/asphalt_02): diffuse, OpenGL normal, roughness.
- [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02): diffuse, OpenGL normal, roughness.

[Poly Haven's CC0 license](https://polyhaven.com/license) permits modification,
redistribution in the repository, and commercial web deployment without attribution.
[CC0 1.0 deed](https://creativecommons.org/publicdomain/zero/1.0/).
`sources.json` records original download URLs, authors, hashes, byte sizes, and
modifications. Downloaded 2026-10-20. No purchase or external runtime CDN is needed.

Both materials use a 3m tile. Asphalt's published scan size is 3m; the concrete
asset has no published physical size in its API metadata, so 3m is an artistic
scale choice. Diffuse maps use sRGB; normal and roughness maps use linear data.
No displacement changes geometry or collision heights. Normal strength is 0.35,
with mipmaps and 4x anisotropy. Metalness is zero.

Rubber streaks are original deterministic Canvas artwork in `Pavement.js`.
Repair overlays reuse the asphalt maps with a darker tint. Neither needs another
download. Maps are shared by the two airports and remain allocated with those
airports; airport and preset changes reuse them. A failed map leaves that slot
unset, retaining the base material. Refreshing the page retries failed requests.
