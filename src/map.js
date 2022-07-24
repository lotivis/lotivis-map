import * as d3 from "d3";
import { baseChart } from "./baseChart.js";
import { config, debug } from "../../lotivis-charts/src/common/config.js";
import { uniqueId } from "../../lotivis-charts/src/common/identifiers.js";
import { tooltip } from "./tooltip.js";
import { DEFAULT_NUMBER_FORMAT } from "../../lotivis-charts/src/common/formats.js";
import { cut, postfix } from "../../lotivis-charts/src/common/helpers.js";
import { Events, DataController } from "lotivis-data";
import {
  geojsonGenerate,
  featuresJoin,
  featuresRemove,
  featuresFilter,
  geojsonAutoFeatureIDAccessor,
  geojsonAutoFeatureNameAccessor,
} from "lotivis-geojson";

import {
  colorScale2,
  colorSchemeDefault,
  ColorsGenerator,
} from "../../lotivis-charts/src/common/colors.js";
import { copy } from "../../lotivis-charts/src/common/values.js";

/**
 * Reusable Map Chart API class that renders a
 * simple and configurable map chart.
 *
 * @requires d3
 *
 * @example
 * var chart = lotivis
 *    .map()
 *    .selector(".css-selector")
 *    .dataController(dc)
 *    .run();
 *
 */
export function map() {
  let attr = {
    id: uniqueId("map"),

    width: 1000,
    height: 1000,

    // margin
    marginLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,

    // Whether the chart is enabled.
    enabled: true,

    // whether to draw labels
    labels: false,

    // a collection of ids NOT to show a label for
    labelsExclude: null,

    // whether to draw a legend on the map
    legend: true,

    legendPanel: true,

    // whether to display a tooltip.
    tooltip: true,

    // array of area ids to remove from the geojson (before rendering)
    exclude: null,

    // array of area ids to filter out from the geojson (before rendering)
    include: null,

    colorScale: colorScale2,

    colorScheme: colorSchemeDefault,

    radius: config.barRadius,

    // the geojson wich is drawn
    geoJSON: null,

    // The data controller.
    dataController: null,

    // presented group
    group: null,

    // the number format
    numberFormat: DEFAULT_NUMBER_FORMAT,

    featureIDAccessor: geojsonAutoFeatureIDAccessor,

    featureNameAccessor: geojsonAutoFeatureNameAccessor,
  };

  // Create new underlying chart with the specified attr.
  let chart = baseChart(attr);
  attr.projection = d3.geoMercator();
  attr.path = d3.geoPath().projection(attr.projection);

  /**
   * Tells the map chart that the GeoJSON has changed.
   * @private
   */
  function geoJSONDidChange() {
    if (!attr.geoJSON) return;

    attr.workGeoJSON = copy(attr.geoJSON);

    // precalculate the center of each feature
    attr.workGeoJSON.features.forEach((f) => (f.center = d3.geoCentroid(f)));

    // precalculate lotivis feature ids
    let feature, id;
    for (let i = 0; i < attr.workGeoJSON.features.length; i++) {
      feature = attr.workGeoJSON.features[i];
      id = attr.featureIDAccessor(feature);
      attr.workGeoJSON.features[i].lotivisId = id;
    }

    // exclude features
    if (Array.isArray(attr.exclude) && attr.exclude.length > 0) {
      attr.workGeoJSON = featuresRemove(
        attr.workGeoJSON,
        attr.exclude,
        attr.featureIDAccessor
      );
    }

    // only use included features
    if (Array.isArray(attr.include) && attr.include.length > 0) {
      attr.workGeoJSON = featuresFilter(
        attr.workGeoJSON,
        attr.include,
        attr.featureIDAccessor
      );
    }

    chart.zoomTo(attr.workGeoJSON);

    if (chart.dataController() === null) {
      chart.dataController(new DataController([]));
    }
  }

  /**
   * Returns the collection of selected features.
   * @returns {Array<feature>} The collection of selected features
   * @private
   */
  function getSelectedFeatures() {
    if (!attr.workGeoJSON) return null;

    let filtered = attr.dataController.filters("locations");
    if (filtered.length === 0) return [];

    return attr.workGeoJSON.features.filter(
      (f) => filtered.indexOf(f.lotivisId) !== -1
    );
  }

  /**
   *
   * @param {*} features
   * @returns
   */
  function htmlTitle(features) {
    if (features.length > 3) {
      let featuresSlice = features.slice(0, 3);
      let ids = featuresSlice
        .map((feature) => `${feature.lotivisId}`)
        .join(", ");
      let names = featuresSlice.map(attr.featureNameAccessor).join(", ");
      let moreCount = features.length - 3;
      return `IDs: ${ids} (+${moreCount})<br>Names: ${names} (+${moreCount})`;
    } else {
      let ids = features.map((feature) => `${feature.lotivisId}`).join(", ");
      let names = features.map(attr.featureNameAccessor).join(", ");
      return `IDs: ${ids}<br>Names: ${names}`;
    }
  }

  /**
   *
   * @param {*} features
   * @param {*} dv
   * @param {*} calc
   * @returns
   */
  function htmlValues(features, dv, calc) {
    let combinedByLabel = {},
      components = [""],
      sum = 0;

    for (let i = 0; i < features.length; i++) {
      let data = dv.byLocationLabel.get(features[i].lotivisId);

      if (!data) continue;
      let keys = Array.from(data.keys());

      for (let j = 0; j < keys.length; j++) {
        let label = keys[j];
        if (combinedByLabel[label]) {
          combinedByLabel[label] += data.get(label);
        } else {
          combinedByLabel[label] = data.get(label);
        }
      }
    }

    if (Object.keys(combinedByLabel).length === 0) return "<br>No Data";

    for (const label in combinedByLabel) {
      let color = calc.colors.label(label),
        divHTML = `<div style="background: ${color};color: ${color}; display: inline;">__</div>`,
        value = combinedByLabel[label];
      if (value === 0) continue;
      sum += value;
      value = attr.numberFormat(value);
      components.push(`${divHTML} ${label}: <b>${value}</b>`);
    }

    components.push("");
    components.push(`Sum: <b>${attr.numberFormat(sum)}</b>`);

    return components.length === 0 ? "No Data" : components.join("<br>");
  }

  /**
   * Updates the tooltips position for the passed feature.
   * @param {*} event
   * @param {*} feature
   * @param {*} calc
   */
  function positionTooltip(event, feature, calc) {
    // position tooltip
    let size = calc.tooltip.size(),
      tOff = config.tooltipOffset,
      projection = attr.projection,
      fBounds = d3.geoBounds(feature),
      fLowerLeft = projection(fBounds[0]),
      fUpperRight = projection(fBounds[1]),
      fWidth = fUpperRight[0] - fLowerLeft[0];

    // svg is presented in dynamic sized view box so we need to get the actual size
    // of the element in order to calculate a scale for the position of the tooltip.
    let domRect = calc.svg.node().getBoundingClientRect(),
      factor = domRect.width / attr.width,
      off = [domRect.x + window.scrollX, domRect.y + window.scrollY];

    let top = fLowerLeft[1] * factor + off[1] + tOff,
      left = (fLowerLeft[0] + fWidth / 2) * factor - size[0] / 2 + off[0];

    calc.tooltip.left(left).top(top).show();
  }

  function contains(arr, obj) {
    return Array.isArray(arr) && arr.indexOf(obj) !== -1;
  }

  /**
   *
   * @param {*} container
   * @param {*} calc
   */
  function renderSVG(container, calc) {
    calc.svg = container
      .append("svg")
      .attr("class", "ltv-chart-svg ltv-map-svg")
      .attr("viewBox", `0 0 ${attr.width} ${attr.height}`);
  }

  function renderBackground(calc, dv) {
    calc.svg
      .append("rect")
      .attr("class", "ltv-map-background")
      .attr("width", attr.width)
      .attr("height", attr.height)
      .on("click", () => {
        attr.dataController.clear("locations", chart);
        renderSelection(calc, dv);
      });
  }

  function renderExteriorBorders(calc, dv) {
    let geoJSON = attr.workGeoJSON;
    if (!geoJSON) return console.log("[ltv]  No GeoJSON to render");

    let bordersGeoJSON = featuresJoin(geoJSON.features);
    if (!bordersGeoJSON) return console.log("[ltv]  No borders to render.");

    calc.borders = calc.svg
      .selectAll(".ltv-map-exterior-borders")
      .append("path")
      .data(bordersGeoJSON.features)
      .enter()
      .append("path")
      .attr("d", attr.path)
      .attr("class", "ltv-map-exterior-borders");
  }

  function filterLocation(location) {
    return attr.dataController.isFilter("locations", location);
  }

  function renderFeatures(calc, dv) {
    function opacity(location) {
      return filterLocation(location) ? config.selectionOpacity : 1;
    }

    function featureMapID(f) {
      return `ltv-map-area-id-${f.lotivisId}`;
    }

    function resetHover() {
      calc.svg
        .selectAll(".ltv-map-area")
        .classed("ltv-map-area-hover", false)
        .attr("opacity", (f) => opacity(f.lotivisId));
    }

    function mouseEnter(event, feature) {
      calc.svg
        .selectAll(`#${featureMapID(feature)}`)
        .classed("ltv-map-area-hover", true);

      if (filterLocation(feature.lotivisId)) {
        calc.tooltip.html(
          [
            htmlTitle(calc.selectedFeatures),
            htmlValues(calc.selectedFeatures, dv, calc),
          ].join("<br>")
        );
        positionTooltip(event, calc.selectionBorderGeoJSON.features[0], calc);
      } else {
        calc.tooltip.html(
          [htmlTitle([feature]), htmlValues([feature], dv, calc)].join("<br>")
        );
        positionTooltip(event, feature, calc);
      }

      calc.tooltip.show();
    }

    function mouseOut(event, feature) {
      resetHover();
      calc.tooltip.hide();
      // dragged
      if (event.buttons === 1) mouseClick(event, feature);
    }

    function mouseClick(event, feature) {
      if (!attr.enabled) return;
      if (!feature || !feature.properties) return;
      attr.dataController.toggleFilter("locations", feature.lotivisId, chart);

      renderSelection(calc, dv);
    }

    let locationToSum = dv.locationToSum;
    let max = d3.max(locationToSum, (item) => item[1]);
    let generator = attr.colorScale;

    calc.areas = calc.svg
      .selectAll(".ltv-map-area")
      .append("path")
      .data(attr.workGeoJSON.features)
      .enter()
      .append("path")
      .attr("d", attr.path)
      .classed("ltv-map-area", true)
      .attr("id", (f) => featureMapID(f))
      .style("stroke-dasharray", "1,4")
      .style("fill", (f) => {
        let value = locationToSum.get(f.lotivisId);
        let opacity = Number(value / max);
        return opacity === 0 ? "WhiteSmoke" : generator(opacity);
      })
      .style("fill-opacity", 1)
      .on("click", mouseClick)
      .on("mouseenter", mouseEnter)
      .on("mouseout", mouseOut)
      .raise();
  }

  /**
   * Renders the labels on the areas.
   * @param {*} calc
   * @param {*} dv
   */
  function renderLabels(calc, dv) {
    // calc.svg.selectAll(".ltv-map-label").remove();
    calc.svg
      .selectAll("text")
      .data(attr.workGeoJSON.features)
      .enter()
      .append("text")
      .attr("class", "ltv-map-label")
      .attr("x", (f) => attr.projection(f.center)[0])
      .attr("y", (f) => attr.projection(f.center)[1])
      .text((f) => {
        let featureID = attr.featureIDAccessor(f);
        if (contains(attr.labelsExclude, featureID)) return "";
        let data = dv.byLocationLabel.get(featureID);
        if (!data) return "";
        let labels = Array.from(data.keys()),
          values = labels.map((label) => data.get(label)),
          sum = d3.sum(values);
        return sum === 0 ? "" : attr.numberFormat(sum);
      });
  }

  function renderSelection(calc, dv) {
    calc.selectedFeatures = getSelectedFeatures();
    calc.selectionBorderGeoJSON = featuresJoin(calc.selectedFeatures);

    if (!calc.selectionBorderGeoJSON)
      return debug("no features selected", chart.id());

    calc.svg.selectAll(".ltv-map-selection-border").remove();
    calc.svg
      .selectAll(".ltv-map-selection-border")
      .append("path")
      .attr("class", "ltv-map-selection-border")
      .data(calc.selectionBorderGeoJSON.features)
      .enter()
      .append("path")
      .attr("d", attr.path)
      .attr("class", "ltv-map-selection-border")
      .raise();
  }

  function renderLegend(calc, dv) {
    let label = attr.selectedGroup || dv.groups[0];
    let locationToSum = dv.locationToSum || [];
    let max = d3.max(locationToSum, (item) => item[1]) || 0;

    let xOff = 10 + attr.marginLeft;
    let labelColor = calc.colors.group(label);

    xOff = 1;

    let mapColors = attr.colorScale;
    let allData = [
      "No Data",
      "0",
      "> 0",
      (1 / 4) * max,
      (1 / 2) * max,
      (3 / 4) * max,
      max,
    ];

    let legend = calc.svg
      .append("svg")
      .attr("class", "ltv-map-legend")
      .attr("width", attr.width)
      .attr("height", 200)
      .attr("x", 0)
      .attr("y", 0);

    // data label title
    legend
      .append("text")
      .attr("class", "ltv-map-legend-title")
      .attr("x", xOff)
      .attr("y", "20")
      .style("fill", labelColor)
      .text(cut(label, 20));

    // rects
    legend
      .append("g")
      .selectAll("rect")
      .data(allData)
      .enter()
      .append("rect")
      .attr("class", "ltv-map-legend-rect")
      .style("fill", (d, i) => {
        return i === 0
          ? "white"
          : i === 1
          ? "whitesmoke"
          : mapColors(i === 2 ? 0 : d / max);
      })
      .attr("x", xOff)
      .attr("y", (d, i) => i * 20 + 30)
      .attr("width", 18)
      .attr("height", 18)
      .style("stroke-dasharray", (d, i) => (i === 0 ? "1,3" : null));

    legend
      .append("g")
      .selectAll("text")
      .data(allData)
      .enter()
      .append("text")
      .attr("class", "ltv-map-legend-text")
      .attr("x", xOff + 24)
      .attr("y", (d, i) => i * 20 + 30 + 14)
      .text((d) => (typeof d === "number" ? attr.numberFormat(d) : d));

    return;
  }

  function renderDataSelectionPanel(calc, dv) {
    let groups = dv.groups;
    let selectedGroup = attr.selectedGroup || groups[0];
    let radioName = attr.id + "-radio";

    calc.legendPanel = calc.container
      .append("div")
      .classed("frc-legend", true)
      .style("padding-left", attr.marginLeft + "px")
      .style("padding-top", attr.marginTop + "px")
      .style("padding-right", attr.marginRight + "px")
      .style("padding-bottom", attr.marginBottom + "px");

    calc.legendPanelPills = calc.legendPanel
      .selectAll(".label")
      .data(groups)
      .enter()
      .append("label")
      .classed("ltv-legend-pill", true);

    calc.legendPanelRadios = calc.legendPanelPills
      .append("input")
      .classed("ltv-legend-radio", true)
      .attr("type", "radio")
      .attr("name", radioName)
      .attr("value", (group) => group)
      .attr("checked", (group) => (group == selectedGroup ? true : null))
      .on("change", (event, group) => {
        if (selectedGroup == group) return;
        Events.call("map-selection-will-change", chart, group);
        attr.selectedGroup = group;
        Events.call("map-selection-did-change", chart, group);
        chart.run();
      });

    calc.legendPanelCpans = calc.legendPanelPills
      .append("span")
      .classed("ltv-legend-pill-span", true)
      .style("border-radius", postfix(attr.radius, "px"))
      .style("background-color", (group) => calc.colors.group(group))
      .text((d, i) => cut(d, 20));
  }

  // public

  chart.zoomTo = function (geoJSON) {
    if (attr.projection)
      attr.projection.fitSize([attr.width - 20, attr.height - 20], geoJSON);
  };

  /**
   * Gets or sets the presented GeoJSON.
   * @param {GeoJSON} _
   * @returns
   */
  chart.geoJSON = function (_) {
    return arguments.length
      ? (((attr.geoJSON = _), geoJSONDidChange()), this)
      : attr.geoJSON;
  };

  /**
   * Calculates the data view for the bar chart.
   * @returns
   */
  chart.dataView = function () {
    let dc = attr.dataController;
    if (!dc) throw new Error("no data controller");

    let dv = {};

    dv.snapshot = dc.snapshot();
    dv.data = dc.snapshot();
    dv.labels = dc.data().labels;
    dv.groups = dc.data().groups;
    dv.locations = dc.data().locations;

    if (!dv.groups.includes(attr.selectedGroup)) attr.selectedGroup = null;

    dv.selectedGroup = attr.selectedGroup || dv.groups[0];
    dv.selectedGroupData = dv.data.filter(
      (d) => (d.group || d.label) == dv.selectedGroup
    );

    dv.byLocationLabel = d3.rollup(
      dv.selectedGroupData,
      (v) => d3.sum(v, (d) => d.value),
      (d) => d.location,
      (d) => d.label
    );

    dv.byLocationGroup = d3.rollup(
      dv.selectedGroupData,
      (v) => d3.sum(v, (d) => d.value),
      (d) => d.location,
      (d) => d.group
    );

    dv.locationToSum = d3.rollup(
      dv.selectedGroupData,
      (v) => d3.sum(v, (d) => d.value),
      (d) => d.location
    );

    dv.maxLocation = d3.max(dv.locationToSum, (item) => item[1]);
    dv.maxLabel = d3.max(dv.byLocationLabel, (i) => d3.max(i[1], (d) => d[1]));
    dv.maxGroup = d3.max(dv.byLocationGroup, (i) => d3.max(i[1], (d) => d[1]));

    return dv;
  };

  /**
   *
   * @param {*} container
   * @param {*} attr
   * @param {*} calc
   * @param {*} dv
   */
  chart.render = function (container, calc, dv) {
    calc.container = container;
    calc.graphWidth = attr.width - attr.marginLeft - attr.marginRight;
    calc.graphHeight = attr.height - attr.marginTop - attr.marginBottom;
    calc.graphBottom = attr.height - attr.marginBottom;
    calc.graphRight = attr.width - attr.marginRight;
    calc.colors = ColorsGenerator(attr.colorScheme).data(dv.data);

    if (!attr.geoJSON) {
      chart.geoJSON(geojsonGenerate(dv.locations));
    }

    renderSVG(container, calc);
    renderBackground(calc, dv);
    renderExteriorBorders(calc, dv);
    renderFeatures(calc, dv);
    renderSelection(calc, dv);

    if (attr.labels) {
      renderLabels(calc, dv);
    }

    if (attr.tooltip) {
      calc.tooltip = tooltip().container(container).run();
    }

    if (attr.legend) {
      renderLegend(calc, dv);
    }

    if (attr.legendPanel) {
      renderDataSelectionPanel(calc, dv);
    }
  };

  Events.on("map-selection-did-change." + chart.id(), function (group) {
    if (this === chart) return debug(chart.id(), "map is sender");
    attr.selectedGroup = group;
    chart.run();
  });

  // return generated chart
  return chart;
}
