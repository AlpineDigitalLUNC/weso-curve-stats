// Custom ECharts 5.5.1 bundle for the WESO curve-stats site: only the charts and
// components the pages use. Rebuild with scripts/build-echarts.sh.
import * as echarts from 'echarts/core';
import { LineChart, BarChart, ScatterChart, EffectScatterChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  DataZoomInsideComponent, DataZoomSliderComponent, MarkLineComponent,
  MarkAreaComponent, TitleComponent, GraphicComponent, AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([
  LineChart, BarChart, ScatterChart, EffectScatterChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  DataZoomInsideComponent, DataZoomSliderComponent, MarkLineComponent,
  MarkAreaComponent, TitleComponent, GraphicComponent, AxisPointerComponent,
  CanvasRenderer,
]);
window.echarts = echarts;
