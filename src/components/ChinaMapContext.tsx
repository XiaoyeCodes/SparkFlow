import { memo, useEffect, useMemo, useState } from 'react';
import { geoBounds, geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';

const LABELS: { name: string; position: [number, number]; water?: boolean }[] = [
  { name: '俄罗斯', position: [111, 57] },
  { name: '蒙古', position: [103, 46.5] },
  { name: '哈萨克斯坦', position: [69, 48] },
  { name: '印度', position: [78, 23] },
  { name: '巴基斯坦', position: [67, 28] },
  { name: '尼泊尔', position: [83, 28] },
  { name: '缅甸', position: [95, 21] },
  { name: '泰国', position: [100, 15] },
  { name: '越南', position: [107, 16] },
  { name: '朝鲜', position: [127, 40] },
  { name: '韩国', position: [128, 36] },
  { name: '日本', position: [139, 37] },
  { name: '菲律宾', position: [124, 12] },
  { name: '太 平 洋', position: [143, 23], water: true },
  { name: '孟 加 拉 湾', position: [88, 14], water: true },
];

// The context and economic overlay share a projection and parent transform.
// Memoization keeps the world geometry out of the pointer-move render path.
export const ChinaMapContext = memo(function ChinaMapContext({
  projection, nationalMap,
}: { projection: GeoProjection; nationalMap?: FeatureCollection<Geometry> }) {
  const [world, setWorld] = useState<FeatureCollection<Geometry> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/data/world-countries-50m.json', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('World context unavailable');
        const topology = await response.json() as Topology<{ countries: GeometryCollection }>;
        if (controller.signal.aborted) return;
        const collection = feature(topology, topology.objects.countries);
        // Generous regional bounds retain surrounding geography, including countries
        // crossing the antimeridian, while excluding remote continents from the SVG.
        collection.features = collection.features.filter(country => {
          const [[west, south], [east, north]] = geoBounds(country);
          return north >= -15 && south <= 75 &&
            (west <= east ? east >= 50 && west <= 155 : east >= 50 || west <= 155);
        });
        setWorld(collection);
      })
      .catch(() => { /* The economic map remains usable if context cannot load. */ });
    return () => controller.abort();
  }, []);

  const model = useMemo(() => {
    // Clip on a copy so the economic overlay's projection is never mutated.
    // Overscan covers panning and SVG letterboxing without drawing whole continents.
    const contextProjection = geoMercator().scale(projection.scale())
      .translate(projection.translate()).center(projection.center())
      .rotate(projection.rotate()).clipExtent([[-450, -305], [1350, 915]]);
    const path = geoPath(contextProjection).digits(2);
    return {
      countries: world?.features.map(country => ({
        id: String(country.id), name: String(country.properties?.name || ''), d: path(country) || '',
      })) || [],
      national: nationalMap ? path(nationalMap) || '' : '',
      labels: LABELS.map(label => ({ ...label, point: projection(label.position) })),
    };
  }, [projection, world, nationalMap]);

  return <g className="china-map-context" aria-hidden="true">
    <g className="china-context-countries">
      {model.countries.map(country => <path key={country.id} d={country.d} data-country={country.name} />)}
    </g>
    {model.national && <path className="china-context-national" d={model.national} />}
    <g className="china-context-labels">
      {model.labels.map(label => label.point && <text key={label.name}
        className={label.water ? 'is-water' : undefined}
        x={label.point[0]} y={label.point[1]}>{label.name}</text>)}
    </g>
  </g>;
});
