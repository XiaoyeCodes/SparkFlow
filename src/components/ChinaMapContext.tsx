import { memo, useMemo } from 'react';
import { geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';

// Preserve the national outline when drilling into a province, using the same
// projection and parent transform as the interactive economic overlay.
export const ChinaMapContext = memo(function ChinaMapContext({
  projection, nationalMap,
}: { projection: GeoProjection; nationalMap?: FeatureCollection<Geometry> }) {
  const national = useMemo(() => {
    // Clip on a copy so the economic overlay's projection is never mutated.
    const contextProjection = geoMercator().scale(projection.scale())
      .translate(projection.translate()).center(projection.center())
      .rotate(projection.rotate()).clipExtent([[-450, -305], [1350, 915]]);
    return nationalMap ? geoPath(contextProjection).digits(2)(nationalMap) || '' : '';
  }, [projection, nationalMap]);

  return <g className="china-map-context" aria-hidden="true">
    {national && <path className="china-context-national" d={national} />}
  </g>;
});
