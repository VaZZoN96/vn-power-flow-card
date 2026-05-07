/*
 * VN Power Flow Card
 * Fixed version: 1.0.1
 */

(() => {
  const CARD_VERSION = "1.0.1";
  const CARD_TAG = "vn-power-flow-card";
  const EDITOR_TAG = "vn-power-flow-card-editor";

  const DEFAULT_NAMES = {
    pv: "PV",
    home: "Home",
    grid: "Grid",
    battery: "Battery",
    sun: "Sun",
  };

  const CLOUDY_STATES = new Set([
    "partly_cloudy",
    "partlycloudy",
    "cloudy",
    "overcast",
    "rainy",
    "pouring",
    "snow",
    "snowy",
    "snow_or_blocked",
    "blocked",
  ]);

  const SNOW_STATES = new Set([
    "snow",
    "snowy",
    "snow_or_blocked",
    "blocked",
  ]);

  const RAIN_STATES = new Set([
    "rainy",
    "pouring",
  ]);

  class VNPowerFlowCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._hass = null;
      this._rendered = false;
      this._lastSunArcPath = "";
      this._lastSkyConnectorPath = "";
      this._uid = Math.random().toString(36).slice(2, 8);
      this._tooltipData = {};
    }

    static getStubConfig() {
      return {
        type: "custom:vn-power-flow-card",
        pv_power: "sensor.pv_power",
        home_power: "sensor.home_power",
        grid_power: "sensor.grid_power",
        battery_power: "sensor.battery_power",
        battery_soc: "sensor.battery_soc",
        sun_entity: "sun.sun",
        cloud_mode: "entity",
        sky_state_override: "off",
        pv_sky_state: "sensor.pv_sky_state",
        grid_positive_direction: "import",
        battery_positive_direction: "discharge",
        threshold_w: 30,
        max_power_w: 10000,
        show_clouds: true,
        show_snow: true,
        show_details: true,
      };
    }

    static getConfigElement() {
      ensureEditorDefined();
      return document.createElement(EDITOR_TAG);
    }

    setConfig(config) {
      if (!config) throw new Error("Invalid configuration");

      this._config = {
        threshold_w: 30,
        max_power_w: 10000,
        cloud_mode: "entity",
        sky_state_override: "off",
        show_clouds: true,
        show_snow: true,
        show_details: true,
        grid_positive_direction: "import",
        battery_positive_direction: "discharge",
        ...config,
      };

      this._rendered = false;
      this._renderBase();
      this._update();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._rendered) this._renderBase();
      this._update();
    }

    getCardSize() {
      return this._bool(this._config?.show_details, true) ? 8 : 6;
    }

    getGridOptions() {
      return {
        columns: "full",
        rows: 12,
        min_columns: 8,
        min_rows: 10,
        max_rows: 18,
      };
    }

    _renderBase() {
      if (!this.shadowRoot) return;

      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>
        <ha-card>
          <div class="vnp-card">
            <div class="vnp-warning" data-role="warning" hidden></div>

            <div class="vnp-stage" data-role="stage">
              <section class="vnp-sky">
                <div class="vnp-stars" data-role="stars">
                  <span></span><span></span><span></span><span></span>
                  <span></span><span></span><span></span><span></span>
                  <span></span><span></span><span></span><span></span>
                </div>

                <svg class="vnp-sky-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path class="vnp-sun-arc" data-role="sun-arc"></path>
                  <line class="vnp-horizon" x1="6" y1="86" x2="94" y2="86"></line>
                  <circle class="vnp-tick" cx="8" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="50" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="92" cy="86" r="1.1"></circle>
                </svg>

                <svg class="vnp-sky-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path class="vnp-sky-flow" data-role="sky-flow"></path>
                </svg>

                <div class="vnp-time vnp-time-rise" data-text="sun-rise">--:--</div>
                <div class="vnp-time vnp-time-noon">12:00</div>
                <div class="vnp-time vnp-time-set" data-text="sun-set">--:--</div>

                <div class="vnp-sun-marker" data-role="sun-marker">
                  <div class="vnp-sun-glow"></div>
                  <div class="vnp-sun-core" data-text="sun-symbol">☀</div>
                </div>

                <div class="vnp-cloud-layer" data-role="cloud-layer">
                  <div class="vnp-cloud vnp-cloud-a"></div>
                  <div class="vnp-cloud vnp-cloud-b"></div>
                  <div class="vnp-cloud vnp-cloud-c"></div>
                  <div class="vnp-cloud vnp-cloud-d"></div>
                  <div class="vnp-cloud vnp-cloud-e"></div>
                </div>

                <div class="vnp-rain-layer" data-role="rain-layer">
                  <span></span><span></span><span></span><span></span>
                  <span></span><span></span><span></span><span></span>
                </div>

                <div class="vnp-snow-layer" data-role="snow-layer">
                  <span>❄</span><span>❄</span><span>❄</span><span>❄</span>
                </div>
              </section>

              <section class="vnp-flow-area">
                <div class="vnp-wire vnp-wire-vertical vnp-wire-sun" data-wire="sun"></div>
                <div class="vnp-wire vnp-wire-vertical vnp-wire-pv" data-wire="pv"></div>
                <div class="vnp-wire vnp-wire-vertical vnp-wire-home" data-wire="home"></div>
                <div class="vnp-wire vnp-wire-horizontal vnp-wire-grid" data-wire="grid"></div>
                <div class="vnp-wire vnp-wire-horizontal vnp-wire-battery" data-wire="battery"></div>

                <div class="vnp-pv-badge">
                  <div class="vnp-pv-panels" data-role="pv-panels"></div>
                  <span data-text="pv-label">PV</span>
                  <strong data-text="pv-power">-- W</strong>
                  <small data-text="pv-sub">Solar input</small>
                  <div class="vnp-pv-ratio-bar" data-role="pv-ratio-bar">
                    <div class="vnp-pv-ratio-fill" data-role="pv-ratio-fill"></div>
                    <span class="vnp-pv-ratio-label" data-text="pv-ratio">--%</span>
                  </div>
                </div>

                <div class="vnp-inverter" data-role="inverter"></div>

                <div class="vnp-grid-node" data-role="grid-node">
                  <div data-role="grid-icon"></div>
                  <div class="vnp-direction-chip" data-text="grid-direction">Idle</div>
                  <div class="vnp-side-value" data-text="grid-power">0 W</div>
                  <div class="vnp-side-sub" data-text="grid-sub">0 W</div>
                </div>

                <div class="vnp-battery-node" data-role="battery-node">
                  <div data-role="battery-icon"></div>
                  <div class="vnp-direction-chip" data-text="battery-direction">Idle</div>
                  <div class="vnp-battery-value" data-text="battery-power">0 W</div>
                  <div class="vnp-battery-sub" data-text="battery-sub">--% / -- V / -- A</div>
                </div>

                <div class="vnp-home-node" data-role="home-node">
                  <div data-role="home-icon"></div>
                  <div class="vnp-home-value" data-text="home-power">-- W</div>
                  <div class="vnp-home-sub" data-text="home-energy">-- kWh</div>
                </div>
              </section>
            </div>

            <div class="vnp-details" data-role="details">
              ${this._detailTile("today-pv", "Today PV", "☀")}
              ${this._detailTile("batt-chg", "Batt Chg", "↯")}
              ${this._detailTile("batt-dis", "Batt Dis.", "↯")}
              ${this._detailTile("grid-import", "Grid Import", "⚡")}
              ${this._detailTile("grid-export", "Grid Export", "⚡")}
              ${this._detailTile("inv-temp", "Inv Temp", "🌡")}
              ${this._detailTile("batt-temp", "Batt Temp", "🌡")}
              ${this._detailTile("temp-2", "Temp 2", "🌡")}
            </div>
          </div>
        </ha-card>
      `;

      this._setHTML('[data-role="inverter"]', this._inverterSvg());
      this._setHTML('[data-role="home-icon"]', this._homeSvg());
      this._setHTML('[data-role="pv-panels"]', this._pvPanelsSvg("clear"));
      this._initTooltips();
      this._rendered = true;
    }

    _initTooltips() {
      const nodes = [
        { sel: '[data-role="grid-node"]', role: "grid" },
        { sel: '[data-role="battery-node"]', role: "battery" },
        { sel: '[data-role="home-node"]', role: "home" },
        { sel: ".vnp-pv-badge", role: "pv" },
        { sel: '[data-role="inverter"]', role: "inverter" },
      ];

      nodes.forEach(({ sel, role }) => {
        const el = this._q(sel);
        if (!el) return;
        el.style.cursor = "pointer";
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this._showTooltip(role);
        });
      });

      this.shadowRoot.addEventListener("click", (event) => {
        const tip = this._q(".vnp-tooltip");
        if (tip && !event.target.closest(".vnp-tooltip")) tip.remove();
      });
    }

    _update() {
      if (!this._hass || !this._config || !this._rendered) return;

      const c = this._config;
      const names = { ...DEFAULT_NAMES, ...(c.names || {}) };
      const threshold = this._number(c.threshold_w, 30);
      const maxPower = Math.max(this._number(c.max_power_w, 10000), 1000);

      const pv1W = Math.max(0, this._readPower(c.pv1_power));
      const pv2W = Math.max(0, this._readPower(c.pv2_power));
      const pvConfiguredW = this._readPower(c.pv_total_power || c.pv_power);
      const pvW = Math.max(0, pvConfiguredW || pv1W + pv2W);
      const homeW = Math.max(0, this._readPower(c.home_power || c.consump));
      const gridRawW = this._readPower(c.grid_power || c.grid_active_power || c.grid_power_alt);
      const batteryRawW = this._readPower(c.battery_power);

      const batterySoc = this._firstNumber([c.battery_soc, c.goodwe_battery_soc]);
      const batteryCurrent = this._firstNumber([c.battery_current, c.goodwe_battery_curr]);
      const batteryVoltage = this._readNumber(c.battery_voltage);
      const batteryTemp1 = this._readNumber(c.battery_temp1);
      const batteryTemp2 = this._readNumber(c.battery_temp2);
      const todayPv = this._readNumber(c.today_pv);
      const todayBattCharge = this._readNumber(c.today_batt_chg);
      const todayBattDischarge = this._readNumber(c.batt_dis);
      const todayLoad = this._readNumber(c.today_load);
      const gridImportEnergy = this._readNumber(c.grid_import_energy);
      const gridExportEnergy = this._readNumber(c.grid_export_energy);
      const inverterTemp = this._readNumber(c.inv_temp);

      const gridPositiveDirection = String(c.grid_positive_direction || "import").toLowerCase();
      const batteryPositiveDirection = String(c.battery_positive_direction || "discharge").toLowerCase();
      const gridImportW = gridPositiveDirection === "import" ? Math.max(0, gridRawW) : Math.max(0, -gridRawW);
      const gridExportW = gridPositiveDirection === "import" ? Math.max(0, -gridRawW) : Math.max(0, gridRawW);
      const batteryDischargeW = batteryPositiveDirection === "discharge" ? Math.max(0, batteryRawW) : Math.max(0, -batteryRawW);
      const batteryChargeW = batteryPositiveDirection === "discharge" ? Math.max(0, -batteryRawW) : Math.max(0, batteryRawW);

      const skyState = this._skyState(c);
      const cloudLevel = this._cloudLevel(skyState);
      const showClouds = this._bool(c.show_clouds, true) && CLOUDY_STATES.has(skyState);
      const showSnow = this._bool(c.show_snow, true) && SNOW_STATES.has(skyState);
      const showRain = RAIN_STATES.has(skyState);
      const sun = this._sunData(c.sun_entity || "sun.sun");
      const missingEntities = this._missingEntities(c, this._hass);
      const pvExpected = this._readNumber(c.pv_expected_power);
      const pvRatio = pvExpected > 0 ? this._clamp((pvW / pvExpected) * 100, 0, 100) : Number.NaN;

      const flows = {
        sunToPv: pvW > threshold && !sun.night,
        pvToInverter: pvW > threshold,
        inverterToHome: homeW > threshold,
        gridImport: gridImportW > threshold,
        gridExport: gridExportW > threshold,
        batteryCharge: batteryChargeW > threshold,
        batteryDischarge: batteryDischargeW > threshold,
      };

      const gridMode = flows.gridImport ? "import" : flows.gridExport ? "export" : "idle";
      const batteryMode = flows.batteryCharge ? "charge" : flows.batteryDischarge ? "discharge" : "idle";

      this._updateWarning(missingEntities);
      this._updateSky(skyState, cloudLevel, showClouds, showSnow, showRain, sun, flows, pvW, maxPower);
      this._updateWires(flows, pvW, homeW, gridImportW, gridExportW, batteryChargeW, batteryDischargeW, maxPower);
      this._updateMainValues(names, pvW, pv1W, pv2W, c, homeW, todayLoad, gridRawW, gridImportW, gridExportW, gridMode, batteryRawW, batterySoc, batteryVoltage, batteryCurrent, batteryMode, pvRatio, skyState);
      this._updateDetails({ todayPv, todayBattCharge, todayBattDischarge, gridImportEnergy, gridExportEnergy, inverterTemp, batteryTemp1, batteryTemp2 });
      this._setDisplay('[data-role="details"]', this._bool(c.show_details, true));

      this._tooltipData = {
        pvW,
        pvRatio,
        homeW,
        gridRawW,
        gridImportW,
        gridExportW,
        gridMode,
        batteryRawW,
        batterySoc,
        batteryVoltage,
        batteryCurrent,
        batteryMode,
        inverterTemp,
      };
    }

    _updateWarning(missingEntities) {
      const warning = this._q('[data-role="warning"]');
      if (!warning) return;

      if (!missingEntities.length) {
        warning.hidden = true;
        warning.textContent = "";
        return;
      }

      warning.hidden = false;
      warning.textContent = `Missing or unavailable entities: ${missingEntities.join(", ")}`;
    }

    _updateSky(skyState, cloudLevel, showClouds, showSnow, showRain, sun, flows, pvW, maxPower) {
      const stage = this._q('[data-role="stage"]');
      if (stage) {
        const nextClass = `vnp-stage vnp-sky-${this._escapeClass(skyState)} vnp-cloud-level-${cloudLevel}`;
        if (stage.className !== nextClass) stage.className = nextClass;
      }

      const arcPath = this._sunArcPath(sun.noonY);
      if (arcPath !== this._lastSunArcPath) {
        this._setAttr('[data-role="sun-arc"]', "d", arcPath);
        this._lastSunArcPath = arcPath;
      }

      const connectorPath = this._sunConnectorPath(sun.x, sun.y);
      if (connectorPath !== this._lastSkyConnectorPath) {
        this._setAttr('[data-role="sky-flow"]', "d", connectorPath);
        this._lastSkyConnectorPath = connectorPath;
      }

      const skyFlow = this._q('[data-role="sky-flow"]');
      if (skyFlow) {
        const nextClass = `vnp-sky-flow ${this._flowClass(flows.sunToPv)}`;
        if (skyFlow.getAttribute("class") !== nextClass) skyFlow.setAttribute("class", nextClass);
        skyFlow.style.setProperty("--duration", `${this._flowDuration(pvW, maxPower)}s`);
      }

      const marker = this._q('[data-role="sun-marker"]');
      if (marker) {
        const nextClass = `vnp-sun-marker ${sun.night ? "vnp-moon" : ""}`;
        if (marker.className !== nextClass) marker.className = nextClass;
        marker.style.setProperty("--sun-x", sun.x);
        marker.style.setProperty("--sun-y", sun.y);
      }

      this._setText('[data-text="sun-symbol"]', sun.night ? "☾" : "☀");
      this._setText('[data-text="sun-rise"]', sun.rise);
      this._setText('[data-text="sun-set"]', sun.set);

      const cloudLayer = this._q('[data-role="cloud-layer"]');
      if (cloudLayer) {
        const nextClass = `vnp-cloud-layer vnp-cloud-${cloudLevel} ${showClouds ? "vnp-visible" : ""}`;
        if (cloudLayer.className !== nextClass) cloudLayer.className = nextClass;
      }

      const snowLayer = this._q('[data-role="snow-layer"]');
      if (snowLayer) {
        const nextClass = `vnp-snow-layer ${showSnow ? "vnp-visible" : ""}`;
        if (snowLayer.className !== nextClass) snowLayer.className = nextClass;
      }

      const rainLayer = this._q('[data-role="rain-layer"]');
      if (rainLayer) {
        const nextClass = `vnp-rain-layer ${showRain ? "vnp-visible" : ""}`;
        if (rainLayer.className !== nextClass) rainLayer.className = nextClass;
      }
    }

    _updateWires(flows, pvW, homeW, gridImportW, gridExportW, batteryChargeW, batteryDischargeW, maxPower) {
      this._setWire("sun", flows.sunToPv, "var(--vnp-sun)", this._flowDuration(pvW, maxPower), false);
      this._setWire("pv", flows.pvToInverter, "var(--vnp-pv)", this._flowDuration(pvW, maxPower), false);
      this._setWire("home", flows.inverterToHome, "var(--vnp-home)", this._flowDuration(homeW, maxPower), false);
      this._setWire("grid", flows.gridImport || flows.gridExport, flows.gridExport ? "var(--vnp-export)" : "var(--vnp-grid)", this._flowDuration(Math.max(gridImportW, gridExportW), maxPower), flows.gridExport);
      this._setWire("battery", flows.batteryCharge || flows.batteryDischarge, "var(--vnp-battery)", this._flowDuration(Math.max(batteryChargeW, batteryDischargeW), maxPower), flows.batteryDischarge);
    }

    _setWire(name, active, color, duration, reverse) {
      const el = this._q(`[data-wire="${name}"]`);
      if (!el) return;

      const baseClasses = {
        sun: "vnp-wire vnp-wire-vertical vnp-wire-sun",
        pv: "vnp-wire vnp-wire-vertical vnp-wire-pv",
        home: "vnp-wire vnp-wire-vertical vnp-wire-home",
        grid: "vnp-wire vnp-wire-horizontal vnp-wire-grid",
        battery: "vnp-wire vnp-wire-horizontal vnp-wire-battery",
      };

      const nextClass = `${baseClasses[name]} ${active ? "vnp-active" : ""} ${reverse ? "vnp-reverse" : ""}`.trim();
      if (el.className !== nextClass) el.className = nextClass;
      el.style.setProperty("--wire-color", color);
      el.style.setProperty("--duration", `${duration}s`);
    }

    _updateMainValues(names, pvW, pv1W, pv2W, config, homeW, todayLoad, gridRawW, gridImportW, gridExportW, gridMode, batteryRawW, batterySoc, batteryVoltage, batteryCurrent, batteryMode, pvRatio, skyState) {
      this._setText('[data-text="pv-label"]', names.pv);
      this._setText('[data-text="pv-power"]', this._formatPower(pvW));
      this._setText('[data-text="pv-sub"]', this._pvSubText(pv1W, pv2W, config));
      this._setHTML('[data-role="pv-panels"]', this._pvPanelsSvg(skyState));

      const pvRatioBar = this._q('[data-role="pv-ratio-bar"]');
      const pvRatioFill = this._q('[data-role="pv-ratio-fill"]');
      if (Number.isFinite(pvRatio)) {
        if (pvRatioBar) pvRatioBar.style.display = "";
        if (pvRatioFill) pvRatioFill.style.width = `${pvRatio}%`;
        this._setText('[data-text="pv-ratio"]', `${Math.round(pvRatio)}%`);
      } else if (pvRatioBar) {
        pvRatioBar.style.display = "none";
      }

      this._setText('[data-text="home-power"]', this._formatPower(homeW));
      this._setText('[data-text="home-energy"]', this._formatEnergy(todayLoad));

      const gridNode = this._q('[data-role="grid-node"]');
      if (gridNode) {
        const nextClass = `vnp-grid-node vnp-grid-${gridMode}`;
        if (gridNode.className !== nextClass) gridNode.className = nextClass;
      }
      this._setHTML('[data-role="grid-icon"]', this._pylonSvg(gridMode));
      this._setText('[data-text="grid-direction"]', gridMode === "import" ? "Import →" : gridMode === "export" ? "← Export" : "Idle");
      this._setText('[data-text="grid-power"]', this._formatSignedPower(gridRawW));
      this._setText('[data-text="grid-sub"]', gridMode === "import" ? this._formatPower(gridImportW) : gridMode === "export" ? this._formatPower(gridExportW) : "0 W");

      const batteryNode = this._q('[data-role="battery-node"]');
      if (batteryNode) {
        const nextClass = `vnp-battery-node vnp-battery-${batteryMode}`;
        if (batteryNode.className !== nextClass) batteryNode.className = nextClass;
      }
      this._setHTML('[data-role="battery-icon"]', this._batterySvg(batterySoc));
      this._setText('[data-text="battery-direction"]', batteryMode === "charge" ? "Charge →" : batteryMode === "discharge" ? "← Discharge" : "Idle");
      this._setText('[data-text="battery-power"]', this._formatSignedPower(batteryRawW));
      this._setText('[data-text="battery-sub"]', `${Number.isFinite(batterySoc) ? `${Math.round(batterySoc)}%` : "--%"} / ${Number.isFinite(batteryVoltage) ? this._formatNumber(batteryVoltage, "V", 1) : "-- V"} / ${Number.isFinite(batteryCurrent) ? this._formatNumber(batteryCurrent, "A", 1) : "-- A"}`);
    }

    _updateDetails(values) {
      this._setText('[data-detail="today-pv"] .vnp-detail-value', this._formatEnergy(values.todayPv));
      this._setText('[data-detail="batt-chg"] .vnp-detail-value', this._formatEnergy(values.todayBattCharge));
      this._setText('[data-detail="batt-dis"] .vnp-detail-value', this._formatEnergy(values.todayBattDischarge));
      this._setText('[data-detail="grid-import"] .vnp-detail-value', this._formatEnergy(values.gridImportEnergy));
      this._setText('[data-detail="grid-export"] .vnp-detail-value', this._formatEnergy(values.gridExportEnergy));
      this._setText('[data-detail="inv-temp"] .vnp-detail-value', this._formatTemp(values.inverterTemp));
      this._setText('[data-detail="batt-temp"] .vnp-detail-value', this._formatTemp(values.batteryTemp1));
      this._setText('[data-detail="temp-2"] .vnp-detail-value', this._formatTemp(values.batteryTemp2));
    }

    _detailTile(key, label, icon) {
      return `
        <div class="vnp-detail" data-detail="${key}">
          <span class="vnp-detail-label"><span class="vnp-detail-icon">${icon}</span>${label}</span>
          <span class="vnp-detail-value">--</span>
        </div>
      `;
    }

    _styles() {
      return `
        :host {
          display: block;
          --vnp-card-bg: var(--ha-card-background, var(--card-background-color, #101820));
          --vnp-text: var(--primary-text-color, #f5f7fb);
          --vnp-muted: var(--secondary-text-color, #9aa7b2);
          --vnp-border: rgba(255, 255, 255, 0.13);
          --vnp-panel: rgba(255, 255, 255, 0.065);
          --vnp-sun: #ffd54f;
          --vnp-pv: #ffb300;
          --vnp-home: #4fc3f7;
          --vnp-grid: #ba68c8;
          --vnp-export: #26c6da;
          --vnp-battery: #66bb6a;
        }

        ha-card {
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 18px);
          background: radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.11), transparent 32%), var(--vnp-card-bg);
          color: var(--vnp-text);
        }

        .vnp-card { box-sizing: border-box; padding: 14px; }
        .vnp-warning { border: 1px solid rgba(255,193,7,.38); background: rgba(255,193,7,.11); border-radius: 12px; padding: 9px 10px; margin: 0 0 10px; font-size: 12px; line-height: 1.35; }
        .vnp-stage { position: relative; overflow: hidden; border: 1px solid var(--vnp-border); border-radius: 18px; background: linear-gradient(180deg, rgba(31,42,56,.92), rgba(10,15,22,.55)); }
        .vnp-stage.vnp-sky-clear { background: radial-gradient(circle at 50% 8%, rgba(255,213,79,.18), transparent 28%), linear-gradient(180deg, rgba(30,51,72,.92), rgba(10,15,22,.52)); }
        .vnp-stage.vnp-sky-night { background: radial-gradient(circle at 50% 8%, rgba(144,202,249,.14), transparent 28%), linear-gradient(180deg, rgba(9,17,32,.96), rgba(4,7,14,.68)); }
        .vnp-stage.vnp-cloud-level-overcast, .vnp-stage.vnp-cloud-level-rain, .vnp-stage.vnp-cloud-level-snow { background: linear-gradient(180deg, rgba(73,83,94,.92), rgba(19,24,31,.72)); }

        .vnp-sky { position: relative; height: 150px; border-bottom: 1px solid rgba(255,255,255,.09); }
        .vnp-sky-svg, .vnp-sky-flow-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .vnp-sun-arc { fill: none; stroke: rgba(255,213,79,.66); stroke-width: 1.1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
        .vnp-horizon { stroke: rgba(255,255,255,.16); stroke-width: .9; vector-effect: non-scaling-stroke; }
        .vnp-tick { fill: rgba(255,255,255,.45); }
        .vnp-sky-flow { fill: none; stroke: var(--vnp-sun); stroke-width: 2.1; stroke-dasharray: 8 8; opacity: 0.18; vector-effect: non-scaling-stroke; }
        .vnp-sky-flow.vnp-active { opacity: 0.95; animation: vnpDash var(--duration, 1.9s) linear infinite; }
        .vnp-sky-flow.vnp-inactive { stroke-dasharray: none; }
        .vnp-time { position: absolute; bottom: 14px; transform: translateX(-50%); color: var(--vnp-muted); font-size: 11px; font-weight: 700; }
        .vnp-time-rise { left: 8%; } .vnp-time-noon { left: 50%; } .vnp-time-set { left: 92%; }

        .vnp-stars span { position: absolute; width: 2px; height: 2px; border-radius: 999px; background: rgba(255,255,255,.7); opacity: 0; }
        .vnp-sky-night .vnp-stars span { opacity: .7; }
        .vnp-stars span:nth-child(1) { left: 10%; top: 18%; } .vnp-stars span:nth-child(2) { left: 18%; top: 36%; }
        .vnp-stars span:nth-child(3) { left: 28%; top: 16%; } .vnp-stars span:nth-child(4) { left: 37%; top: 31%; }
        .vnp-stars span:nth-child(5) { left: 49%; top: 12%; } .vnp-stars span:nth-child(6) { left: 58%; top: 34%; }
        .vnp-stars span:nth-child(7) { left: 69%; top: 18%; } .vnp-stars span:nth-child(8) { left: 80%; top: 30%; }
        .vnp-stars span:nth-child(9) { left: 88%; top: 16%; } .vnp-stars span:nth-child(10) { left: 24%; top: 48%; }
        .vnp-stars span:nth-child(11) { left: 64%; top: 48%; } .vnp-stars span:nth-child(12) { left: 92%; top: 46%; }

        .vnp-sun-marker { position: absolute; left: calc(var(--sun-x, 50) * 1%); top: calc(var(--sun-y, 86) * 1%); z-index: 7; width: 48px; height: 48px; transform: translate(-50%, -50%); }
        .vnp-sun-glow { position: absolute; inset: 4px; border-radius: 999px; background: radial-gradient(circle, rgba(255,244,179,.38), rgba(255,213,79,.11) 48%, transparent 74%); box-shadow: 0 0 15px rgba(255,213,79,.22); }
        .vnp-sun-core { position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; transform: translate(-50%, -50%); display: grid; place-items: center; border-radius: 999px; background: rgba(255,213,79,.17); box-shadow: 0 0 10px rgba(255,213,79,.24); font-size: 22px; }
        .vnp-moon .vnp-sun-glow { background: radial-gradient(circle, rgba(144,202,249,.24), transparent 72%); box-shadow: 0 0 14px rgba(144,202,249,.18); }
        .vnp-moon .vnp-sun-core { background: rgba(144,202,249,.12); box-shadow: 0 0 14px rgba(144,202,249,.24); }

        .vnp-cloud-layer { position: absolute; z-index: 8; left: 24%; top: 38%; width: 52%; height: 48%; opacity: 0; pointer-events: none; transition: opacity .35s ease, width .35s ease, left .35s ease; }
        .vnp-cloud-layer.vnp-cloud-partly.vnp-visible { opacity: .42; }
        .vnp-cloud-layer.vnp-cloud-cloudy.vnp-visible { opacity: .82; }
        .vnp-cloud-layer.vnp-cloud-overcast.vnp-visible, .vnp-cloud-layer.vnp-cloud-rain.vnp-visible, .vnp-cloud-layer.vnp-cloud-snow.vnp-visible { opacity: .98; left: 15%; width: 70%; }
        .vnp-cloud { position: absolute; width: 30%; height: 25%; border-radius: 999px; background: rgba(236,239,241,.86); box-shadow: 0 0 12px rgba(255,255,255,.16); animation: vnpCloud 12s ease-in-out infinite alternate; }
        .vnp-cloud::before, .vnp-cloud::after { content: ""; position: absolute; bottom: 30%; border-radius: 999px; background: inherit; }
        .vnp-cloud::before { left: 14%; width: 42%; height: 110%; } .vnp-cloud::after { left: 48%; width: 54%; height: 135%; }
        .vnp-cloud-a { left: 8%; top: 30%; } .vnp-cloud-b { left: 38%; top: 42%; transform: scale(.82); animation-duration: 14s; }
        .vnp-cloud-c { left: 58%; top: 14%; transform: scale(.70); opacity: .80; animation-duration: 16s; }
        .vnp-cloud-d { left: 18%; top: 58%; transform: scale(.78); opacity: .78; animation-duration: 18s; }
        .vnp-cloud-e { left: 72%; top: 48%; transform: scale(.70); opacity: .76; animation-duration: 20s; }
        .vnp-cloud-partly .vnp-cloud-c, .vnp-cloud-partly .vnp-cloud-d, .vnp-cloud-partly .vnp-cloud-e { display: none; }
        .vnp-cloud-cloudy .vnp-cloud-d { display: none; }
        .vnp-cloud-overcast .vnp-cloud, .vnp-cloud-rain .vnp-cloud, .vnp-cloud-snow .vnp-cloud { background: rgba(210,218,224,.92); }
        @keyframes vnpCloud { from { margin-left: -2%; } to { margin-left: 4%; } }

        .vnp-rain-layer { position: absolute; z-index: 9; left: 30%; top: 45%; width: 40%; height: 48%; opacity: 0; pointer-events: none; transition: opacity .35s ease; }
        .vnp-rain-layer.vnp-visible { opacity: 1; }
        .vnp-rain-layer span { position: absolute; top: 0; width: 2px; height: 16px; border-radius: 999px; background: rgba(144,202,249,.82); animation: vnpRain 1s linear infinite; }
        .vnp-rain-layer span:nth-child(1) { left: 6%; animation-delay: 0s; } .vnp-rain-layer span:nth-child(2) { left: 18%; animation-delay: .12s; }
        .vnp-rain-layer span:nth-child(3) { left: 31%; animation-delay: .24s; } .vnp-rain-layer span:nth-child(4) { left: 44%; animation-delay: .36s; }
        .vnp-rain-layer span:nth-child(5) { left: 57%; animation-delay: .48s; } .vnp-rain-layer span:nth-child(6) { left: 70%; animation-delay: .60s; }
        .vnp-rain-layer span:nth-child(7) { left: 82%; animation-delay: .72s; } .vnp-rain-layer span:nth-child(8) { left: 94%; animation-delay: .84s; }
        @keyframes vnpRain { from { transform: translateY(0) rotate(12deg); opacity: 0; } 20% { opacity: 1; } to { transform: translateY(64px) rotate(12deg); opacity: 0; } }

        .vnp-snow-layer { position: absolute; z-index: 9; left: 36%; top: 50%; width: 28%; height: 44%; opacity: 0; pointer-events: none; transition: opacity .35s ease; }
        .vnp-snow-layer.vnp-visible { opacity: 1; }
        .vnp-snow-layer span { position: absolute; top: 0; color: rgba(225,245,254,.95); animation: vnpSnow 3.8s linear infinite; }
        .vnp-snow-layer span:nth-child(1) { left: 8%; animation-delay: 0s; } .vnp-snow-layer span:nth-child(2) { left: 34%; animation-delay: .7s; }
        .vnp-snow-layer span:nth-child(3) { left: 62%; animation-delay: 1.4s; } .vnp-snow-layer span:nth-child(4) { left: 88%; animation-delay: 2.1s; }
        @keyframes vnpSnow { from { transform: translateY(0) rotate(0deg); opacity: 0; } 20% { opacity: 1; } to { transform: translateY(58px) rotate(180deg); opacity: 0; } }

        .vnp-flow-area { position: relative; min-height: 490px; }
        .vnp-wire { position: absolute; z-index: 1; border-radius: 999px; background: rgba(255,255,255,.11); overflow: hidden; opacity: .9; }
        .vnp-wire::after { content: ""; position: absolute; opacity: 0; }
        .vnp-wire.vnp-active::after { opacity: 1; animation-duration: var(--duration, 1.8s); animation-timing-function: linear; animation-iteration-count: infinite; }
        .vnp-wire.vnp-reverse::after { animation-direction: reverse; }
        .vnp-wire-vertical { left: calc(50% - 3px); width: 6px; }
        .vnp-wire-horizontal { top: calc(49% - 3px); height: 6px; }
        .vnp-wire-vertical::after { left: 0; top: -16px; width: 100%; height: calc(100% + 32px); background: repeating-linear-gradient(to bottom, var(--wire-color) 0 8px, transparent 8px 16px); animation-name: vnpWireY; }
        .vnp-wire-horizontal::after { left: -16px; top: 0; width: calc(100% + 32px); height: 100%; background: repeating-linear-gradient(to right, var(--wire-color) 0 8px, transparent 8px 16px); animation-name: vnpWireX; }
        .vnp-wire-sun { top: 0; height: 20%; } .vnp-wire-pv { top: 24%; height: 19%; } .vnp-wire-home { top: 56%; height: 26%; }
        .vnp-wire-grid { left: 20%; width: 27%; } .vnp-wire-battery { left: 53%; width: 27%; }
        @keyframes vnpWireY { from { transform: translateY(-16px); } to { transform: translateY(0); } }
        @keyframes vnpWireX { from { transform: translateX(-16px); } to { transform: translateX(0); } }
        @keyframes vnpDash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -16; } }

        .vnp-pv-badge, .vnp-inverter, .vnp-grid-node, .vnp-battery-node, .vnp-home-node { position: absolute; z-index: 3; box-sizing: border-box; transform: translate(-50%, -50%); }
        .vnp-pv-badge { left: 50%; top: 20%; width: clamp(112px, 23%, 152px); border: 1px solid rgba(255,213,79,.32); border-radius: 13px; background: rgba(255,179,0,.10); box-shadow: 0 0 18px rgba(255,179,0,.10); padding: 8px 10px; text-align: center; backdrop-filter: blur(7px); }
        .vnp-pv-badge span, .vnp-pv-badge small { display: block; color: var(--vnp-muted); font-size: 11px; font-weight: 800; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-pv-badge strong { display: block; margin: 3px 0; color: var(--vnp-text); font-size: 18px; font-weight: 900; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-pv-panels { width: 78px; height: 34px; margin: 0 auto 5px; }
        .vnp-pv-panels svg { display: block; width: 100%; height: 100%; overflow: visible; }
        .vnp-pv-ratio-bar { position: relative; height: 12px; margin-top: 6px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.11); }
        .vnp-pv-ratio-fill { position: absolute; inset: 0 auto 0 0; width: 0%; border-radius: inherit; background: linear-gradient(90deg, rgba(255,179,0,.55), rgba(255,213,79,.92)); transition: width .35s ease; }
        .vnp-pv-ratio-label { position: relative; z-index: 1; display: block; color: rgba(255,255,255,.92) !important; font-size: 9px !important; line-height: 12px !important; text-shadow: 0 1px 2px rgba(0,0,0,.45); }

        .vnp-inverter { left: 50%; top: 49%; width: clamp(145px, 26%, 195px); height: clamp(108px, 21%, 142px); display: grid; place-items: center; background: transparent; }
        .vnp-inverter svg { display: block; width: 100%; height: 100%; overflow: visible; }
        .vnp-grid-node, .vnp-battery-node { top: 49%; width: clamp(110px, 22%, 142px); min-height: 166px; border: 1px solid var(--vnp-border); border-radius: 16px; background: var(--vnp-panel); padding: 8px; text-align: center; backdrop-filter: blur(8px); }
        .vnp-grid-node { left: 17%; } .vnp-battery-node { left: 83%; }
        .vnp-grid-node svg { display: block; width: 100%; height: 82px; margin: 0 auto 4px; }
        .vnp-battery-node svg { display: block; width: 100%; height: 92px; margin: 0 auto 4px; }
        .vnp-direction-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; border-radius: 999px; padding: 3px 7px; margin: 1px 0 5px; background: rgba(255,255,255,.08); color: var(--vnp-muted); font-size: 11px; font-weight: 900; line-height: 1; }
        .vnp-grid-import .vnp-direction-chip { color: var(--vnp-grid); background: rgba(186,104,200,.13); }
        .vnp-grid-export .vnp-direction-chip { color: var(--vnp-export); background: rgba(38,198,218,.13); }
        .vnp-battery-charge .vnp-direction-chip, .vnp-battery-discharge .vnp-direction-chip { color: var(--vnp-battery); background: rgba(102,187,106,.13); }
        .vnp-side-value, .vnp-battery-value, .vnp-home-value { overflow: hidden; color: var(--vnp-text); font-size: 16px; font-weight: 900; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-side-sub, .vnp-battery-sub, .vnp-home-sub { margin-top: 4px; overflow: hidden; color: var(--vnp-muted); font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-home-node { left: 50%; top: 84%; width: clamp(148px, 31%, 200px); border: 1px solid var(--vnp-border); border-radius: 18px; background: var(--vnp-panel); padding: 10px; text-align: center; backdrop-filter: blur(8px); }
        .vnp-home-node svg { display: block; width: 102px; height: 74px; margin: 0 auto 6px; overflow: visible; }
        .vnp-home-value { font-size: 18px; }

        .vnp-details { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
        .vnp-detail { min-width: 0; border: 1px solid var(--vnp-border); border-radius: 13px; background: rgba(255,255,255,.055); padding: 8px; }
        .vnp-detail-icon { display: inline-block; margin-right: 4px; opacity: .9; }
        .vnp-detail-label { display: block; overflow: hidden; color: var(--vnp-muted); font-size: 11px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-detail-value { display: block; overflow: hidden; margin-top: 3px; font-size: 13px; font-weight: 900; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }

        .vnp-tooltip { position: absolute; z-index: 30; left: 50%; top: 50%; width: min(260px, calc(100% - 28px)); box-sizing: border-box; transform: translate(-50%, -50%); border: 1px solid var(--vnp-border); border-radius: 14px; background: rgba(10,15,22,.94); box-shadow: 0 14px 32px rgba(0,0,0,.34); padding: 11px 12px; backdrop-filter: blur(12px); }
        .vnp-tooltip-title { margin-bottom: 8px; font-size: 13px; font-weight: 900; }
        .vnp-tooltip-row { display: flex; justify-content: space-between; gap: 14px; border-top: 1px solid rgba(255,255,255,.08); padding: 6px 0 0; margin-top: 6px; color: var(--vnp-muted); font-size: 12px; }
        .vnp-tooltip-row strong { color: var(--vnp-text); white-space: nowrap; }

        @media (max-width: 620px) {
          .vnp-card { padding: 12px; } .vnp-sky { height: 132px; } .vnp-flow-area { min-height: 530px; }
          .vnp-inverter { top: 47%; width: 126px; height: 98px; }
          .vnp-pv-badge { top: 18%; width: 116px; }
          .vnp-grid-node { left: 16%; top: 48%; width: 98px; min-height: 154px; padding: 7px; }
          .vnp-battery-node { left: 84%; top: 48%; width: 98px; min-height: 154px; padding: 7px; }
          .vnp-grid-node svg { height: 70px; } .vnp-battery-node svg { height: 84px; }
          .vnp-home-node { top: 84%; width: 152px; } .vnp-home-node svg { width: 86px; height: 64px; }
          .vnp-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 390px) {
          .vnp-flow-area { min-height: 540px; } .vnp-grid-node { left: 15%; width: 90px; } .vnp-battery-node { left: 85%; width: 90px; }
          .vnp-inverter { width: 116px; height: 90px; } .vnp-pv-badge { width: 108px; }
          .vnp-side-value, .vnp-battery-value, .vnp-home-value { font-size: 15px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vnp-wire.vnp-active::after, .vnp-sky-flow.vnp-active, .vnp-cloud, .vnp-rain-layer span, .vnp-snow-layer span { animation: none; }
        }
      `;
    }

    _missingEntities(config, hass) {
      if (!hass) return [];
      const keys = [
        "pv_power", "pv_total_power", "pv1_power", "pv2_power",
        "home_power", "consump",
        "grid_power", "grid_active_power", "grid_power_alt",
        "battery_power", "battery_soc", "goodwe_battery_soc",
        "battery_current", "goodwe_battery_curr", "battery_voltage",
        "battery_temp1", "battery_temp2",
        "today_pv", "today_batt_chg", "batt_dis", "today_load",
        "grid_import_energy", "grid_export_energy", "inv_temp",
        "sun_entity", "pv_sky_state", "weather_entity", "cloud_coverage_entity",
        "pv_expected_power",
      ];
      return keys.map((key) => config[key]).filter((entity) => entity && !hass.states[entity]);
    }

    _skyState(config) {
      const mode = String(config.cloud_mode || "entity").toLowerCase();

      if (config.sky_state_override && String(config.sky_state_override).toLowerCase() !== "off") {
        return this._normalizeSkyState(config.sky_state_override);
      }
      if (mode === "off") return "clear";

      const sunEntity = config.sun_entity || "sun.sun";
      const sunState = this._readState(sunEntity);
      const elevation = this._readAttributeNumber(sunEntity, "elevation");
      if (sunState === "below_horizon") return "night";
      if (Number.isFinite(elevation) && elevation < 6) return "low_sun";

      if ((mode === "entity" || mode === "auto") && config.pv_sky_state) {
        const entityState = this._readState(config.pv_sky_state);
        if (entityState && !["unknown", "unavailable"].includes(entityState)) return this._normalizeSkyState(entityState);
      }

      if (mode === "auto" && config.cloud_coverage_entity) {
        const coverage = this._readNumber(config.cloud_coverage_entity);
        const threshold = this._number(config.cloud_coverage_threshold, 55);
        if (Number.isFinite(coverage)) {
          if (coverage >= 85) return "overcast";
          if (coverage >= threshold) return "cloudy";
          if (coverage >= Math.max(20, threshold * 0.55)) return "partly_cloudy";
          return "clear";
        }
      }

      if (mode === "auto" && config.weather_entity) {
        const weatherState = this._readState(config.weather_entity);
        if (weatherState && !["unknown", "unavailable"].includes(weatherState)) return this._normalizeSkyState(weatherState);
      }

      return "clear";
    }

    _normalizeSkyState(value) {
      const normalized = String(value || "unknown").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
      const map = {
        sunny: "clear",
        clear_sky: "clear",
        clear: "clear",
        partlycloudy: "partly_cloudy",
        partly_cloudy: "partly_cloudy",
        cloudy: "cloudy",
        overcast: "overcast",
        rainy: "rainy",
        pouring: "rainy",
        snow: "snow",
        snowy: "snow",
        snow_or_blocked: "snow_or_blocked",
        blocked: "snow_or_blocked",
        low_sun: "low_sun",
        night: "night",
      };
      return map[normalized] || normalized || "unknown";
    }

    _cloudLevel(skyState) {
      if (skyState === "partly_cloudy" || skyState === "partlycloudy") return "partly";
      if (skyState === "cloudy") return "cloudy";
      if (skyState === "overcast") return "overcast";
      if (skyState === "rainy" || skyState === "pouring") return "rain";
      if (SNOW_STATES.has(skyState)) return "snow";
      return "none";
    }

    _sunData(entityId) {
      const state = this._readState(entityId);
      const attrs = this._hass?.states?.[entityId]?.attributes || {};
      const elevation = this._readAttributeNumber(entityId, "elevation");
      const nextRise = this._dateFromAttr(attrs.next_rising);
      const nextSet = this._dateFromAttr(attrs.next_setting);
      const now = new Date();
      const above = state === "above_horizon";
      const night = !above;
      const noonElevation = this._estimateNoonElevation(entityId, attrs.next_noon);
      const noonY = this._clamp(86 - noonElevation * 1.05, 15, 58);
      let riseDate = nextRise;
      let setDate = nextSet;

      if (above && riseDate && setDate && riseDate > setDate) {
        riseDate = new Date(riseDate.getTime() - 24 * 60 * 60 * 1000);
      }

      const riseLabel = this._formatTime(riseDate || nextRise, "06:00");
      const setLabel = this._formatTime(setDate || nextSet, "18:00");
      let x = 50;
      let y = 86;

      if (!night && riseDate && setDate && setDate > riseDate) {
        const t = this._clamp((now.getTime() - riseDate.getTime()) / (setDate.getTime() - riseDate.getTime()), 0, 1);
        const p = this._cubicPoint(t, { x: 8, y: 86 }, { x: 25, y: noonY }, { x: 75, y: noonY }, { x: 92, y: 86 });
        x = p.x;
        y = p.y;
      } else if (Number.isFinite(elevation) && elevation > 0) {
        const approxT = this._clamp((now.getHours() + now.getMinutes() / 60 - 6) / 12, 0, 1);
        const p = this._cubicPoint(approxT, { x: 8, y: 86 }, { x: 25, y: noonY }, { x: 75, y: noonY }, { x: 92, y: 86 });
        x = p.x;
        y = p.y;
      } else {
        const minutes = now.getHours() * 60 + now.getMinutes();
        const t = minutes >= 18 * 60 ? (minutes - 18 * 60) / (12 * 60) : (minutes + 6 * 60) / (12 * 60);
        const progress = this._clamp(t, 0, 1);
        x = 92 - 84 * progress;
        y = 90 - 12 * Math.sin(progress * Math.PI);
      }

      return {
        rise: riseLabel,
        set: setLabel,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        noonY: Math.round(noonY * 10) / 10,
        night,
      };
    }

    _cubicPoint(t, p0, p1, p2, p3) {
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;
      return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
      };
    }

    _dateFromAttr(value) {
      try {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      } catch (error) {
        return null;
      }
    }

    _formatTime(date, fallback) {
      try {
        if (!date) return fallback;
        return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      } catch (error) {
        return fallback;
      }
    }

    _estimateNoonElevation(entityId, nextNoon) {
      const currentElevation = this._readAttributeNumber(entityId, "elevation");
      try {
        const noonDate = nextNoon ? new Date(nextNoon) : new Date();
        const day = this._dayOfYear(Number.isNaN(noonDate.getTime()) ? new Date() : noonDate);
        const latitude = this._hass?.config?.latitude;
        if (!Number.isFinite(latitude)) return Number.isFinite(currentElevation) ? Math.max(currentElevation, 25) : 45;
        const declination = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365);
        return this._clamp(90 - Math.abs(latitude - declination), 5, 75);
      } catch (error) {
        return Number.isFinite(currentElevation) ? Math.max(currentElevation, 25) : 45;
      }
    }

    _sunArcPath(noonY) {
      const y = this._clamp(this._number(noonY, 32), 15, 58);
      return `M8 86 C25 ${y} 75 ${y} 92 86`;
    }

    _sunConnectorPath(x, y) {
      const startX = this._clamp(this._number(x, 50), 8, 92);
      const startY = this._clamp(this._number(y, 50), 8, 92);
      return `M${startX} ${startY} C${startX} ${Math.min(96, startY + 22)} 50 88 50 100`;
    }

    _dayOfYear(date) {
      const start = new Date(date.getFullYear(), 0, 0);
      const diff = date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000;
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    }

    _pvSubText(pv1W, pv2W, config) {
      const parts = [];
      if (config.pv1_power) parts.push(`PV1 ${this._formatPower(pv1W)}`);
      if (config.pv2_power) parts.push(`PV2 ${this._formatPower(pv2W)}`);
      return parts.length ? parts.join(" / ") : "Solar input";
    }

    _flowClass(active) {
      return active ? "vnp-active" : "vnp-inactive";
    }

    _flowDuration(value, maxPower) {
      return (2.8 - this._clamp(Math.abs(value) / maxPower, 0, 1) * 1.5).toFixed(2);
    }

    _readPower(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return 0;
      const entity = this._hass.states[entityId];
      const raw = Number.parseFloat(String(entity.state).replace(",", "."));
      if (!Number.isFinite(raw)) return 0;
      const unit = String(entity.attributes?.unit_of_measurement || "").trim().toLowerCase();
      if (unit === "kw") return raw * 1000;
      if (unit === "mw") return raw * 1000000;
      return raw;
    }

    _readNumber(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return Number.NaN;
      const raw = Number.parseFloat(String(this._hass.states[entityId].state).replace(",", "."));
      return Number.isFinite(raw) ? raw : Number.NaN;
    }

    _firstNumber(entityIds) {
      for (const entityId of entityIds) {
        const value = this._readNumber(entityId);
        if (Number.isFinite(value)) return value;
      }
      return Number.NaN;
    }

    _readAttributeNumber(entityId, attribute) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return Number.NaN;
      const value = this._hass.states[entityId].attributes?.[attribute];
      const raw = Number.parseFloat(String(value).replace(",", "."));
      return Number.isFinite(raw) ? raw : Number.NaN;
    }

    _readState(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return "";
      return String(this._hass.states[entityId].state || "").trim().toLowerCase();
    }

    _formatPower(value) {
      const abs = Math.abs(value);
      if (!Number.isFinite(abs)) return "--";
      if (abs >= 1000) return `${(abs / 1000).toFixed(abs >= 10000 ? 1 : 2)} kW`;
      return `${Math.round(abs)} W`;
    }

    _formatSignedPower(value) {
      if (!Number.isFinite(value)) return "--";
      if (Math.abs(value) < 0.5) return "0 W";
      return `${value > 0 ? "+" : "-"}${this._formatPower(value)}`;
    }

    _formatEnergy(value) {
      return Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)} kWh` : "-- kWh";
    }

    _formatTemp(value) {
      return Number.isFinite(value) ? `${value.toFixed(0)} °C` : "-- °C";
    }

    _formatNumber(value, unit, decimals) {
      return Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : `-- ${unit}`;
    }

    _batterySoc(value) {
      return Number.isFinite(value) ? this._clamp(value, 0, 100) : 0;
    }

    _socColor(value) {
      if (!Number.isFinite(value)) return "#607d8b";
      if (value <= 20) return "#ff3d00";
      if (value <= 40) return "#f4d03f";
      if (value <= 75) return "#44d66a";
      return "#00bcd4";
    }

    _number(value, fallback) {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : fallback;
    }

    _bool(value, fallback) {
      if (value === undefined || value === null) return fallback;
      if (typeof value === "boolean") return value;
      return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
    }

    _clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    _q(selector) {
      return this.shadowRoot?.querySelector(selector);
    }

    _setText(selector, value) {
      const el = this._q(selector);
      if (!el) return;
      const next = String(value ?? "");
      if (el.textContent !== next) el.textContent = next;
    }

    _setHTML(selector, value) {
      const el = this._q(selector);
      if (!el) return;
      const next = String(value ?? "");
      if (el.innerHTML !== next) el.innerHTML = next;
    }

    _setAttr(selector, attr, value) {
      const el = this._q(selector);
      if (!el) return;
      const next = String(value ?? "");
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    }

    _setDisplay(selector, visible) {
      const el = this._q(selector);
      if (!el) return;
      el.style.display = visible ? "" : "none";
    }

    _escapeClass(value) {
      return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
    }

        _pvPanelsSvg(skyState = "clear") {
      const uid = this._uid;
      const state = this._normalizeSkyState(skyState);

      const isBlocked = state === "snow_or_blocked" || state === "blocked";
      const hasSnow = SNOW_STATES.has(state);

      const shadeOpacity =
        state === "night"
          ? "0.70"
          : isBlocked
            ? "0.48"
            : state === "overcast" || state === "rainy" || hasSnow
              ? "0.42"
              : state === "cloudy"
                ? "0.28"
                : state === "partly_cloudy"
                  ? "0.16"
                  : "0";

      const snowOverlay = isBlocked
        ? `
          <g aria-label="Snow blocked panels">
            <path d="M13 13 H83 L78 29 C69 32 60 27 51 30 C41 33 31 29 21 32 L14 32 Z"
              fill="rgba(238,248,255,.96)"></path>
            <path d="M15 18 C25 15 33 20 42 17 C52 14 60 20 70 17 C76 15 80 16 82 17 L79 27 C71 30 62 25 53 28 C43 31 34 27 24 30 C20 31 17 31 14 31 Z"
              fill="rgba(255,255,255,.88)"></path>
            <path d="M20 34 C30 31 39 35 48 32 C57 29 67 34 76 31"
              fill="none"
              stroke="rgba(255,255,255,.86)"
              stroke-width="3"
              stroke-linecap="round"></path>
            <text x="48" y="26"
              text-anchor="middle"
              font-size="8"
              font-weight="900"
              fill="rgba(20,35,48,.72)">BLOCKED</text>
          </g>
        `
        : hasSnow
          ? `
            <g aria-label="Snow on panels">
              <path d="M16 13 H40 C45 13 47 17 43 20 C35 24 25 19 17 22 Z"
                fill="rgba(238,248,255,.90)"></path>
              <path d="M55 14 H82 L79 23 C70 25 63 20 54 23 Z"
                fill="rgba(238,248,255,.82)"></path>
              <circle cx="30" cy="29" r="2.2" fill="rgba(255,255,255,.86)"></circle>
              <circle cx="63" cy="28" r="1.8" fill="rgba(255,255,255,.82)"></circle>
            </g>
          `
          : "";

      return `
        <svg viewBox="0 0 96 44" role="img" aria-label="PV panels">
          <defs>
            <linearGradient id="vnpPvPanel_${uid}" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#263f8f"></stop>
              <stop offset="1" stop-color="#071735"></stop>
            </linearGradient>
            <linearGradient id="vnpPvFrame_${uid}" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(255,255,255,.86)"></stop>
              <stop offset="1" stop-color="rgba(135,150,162,.72)"></stop>
            </linearGradient>
          </defs>

          <g filter="drop-shadow(0 7px 7px rgba(0,0,0,.28))">
            <path d="M9 10 H87 L79 35 H17 Z"
              fill="url(#vnpPvFrame_${uid})"
              opacity=".95"></path>

            <path d="M14 13 H82 L75 32 H21 Z"
              fill="url(#vnpPvPanel_${uid})"></path>

            <path d="M28 13 L24 32 M42 13 L39 32 M55 13 L57 32 M69 13 L72 32"
              stroke="rgba(255,255,255,.32)"
              stroke-width="1"></path>

            <path d="M16 19 H80 M18 25 H78"
              stroke="rgba(255,255,255,.25)"
              stroke-width="1"></path>

            <path d="M40 35 H56 L60 40 H36 Z"
              fill="rgba(180,190,196,.82)"></path>

            <path d="M14 13 H82 L75 32 H21 Z"
              fill="rgba(0,0,0,${shadeOpacity})"></path>

            ${snowOverlay}

            <path d="M21 15 L31 15"
              stroke="rgba(255,255,255,.70)"
              stroke-width="1.4"
              stroke-linecap="round"></path>
          </g>
        </svg>
      `;
    }

    _showTooltip(role) {
      const oldTip = this._q(".vnp-tooltip");
      if (oldTip) oldTip.remove();

      const rows = this._tooltipRows(role);
      if (!rows.length) return;

      const tip = document.createElement("div");
      tip.className = "vnp-tooltip";
      tip.innerHTML = `
        <div class="vnp-tooltip-title">${this._tooltipTitle(role)}</div>
        ${rows.map(([label, value]) => `<div class="vnp-tooltip-row"><span>${label}</span><strong>${value}</strong></div>`).join("")}
      `;

      const stage = this._q('[data-role="stage"]') || this.shadowRoot;
      stage.appendChild(tip);
    }

    _tooltipTitle(role) {
      const titles = { pv: "PV", grid: "Grid", battery: "Battery", home: "Home", inverter: "Inverter" };
      return titles[role] || "Details";
    }

    _tooltipRows(role) {
      const d = this._tooltipData || {};
      if (role === "pv") return [["Power", this._formatPower(d.pvW)], ["Expected", Number.isFinite(d.pvRatio) ? `${Math.round(d.pvRatio)}%` : "--"]];
      if (role === "grid") return [["Mode", d.gridMode || "idle"], ["Raw", this._formatSignedPower(d.gridRawW)], ["Import", this._formatPower(d.gridImportW)], ["Export", this._formatPower(d.gridExportW)]];
      if (role === "battery") return [["Mode", d.batteryMode || "idle"], ["Power", this._formatSignedPower(d.batteryRawW)], ["SOC", Number.isFinite(d.batterySoc) ? `${Math.round(d.batterySoc)}%` : "--%"], ["Voltage", this._formatNumber(d.batteryVoltage, "V", 1)], ["Current", this._formatNumber(d.batteryCurrent, "A", 1)]];
      if (role === "home") return [["Consumption", this._formatPower(d.homeW)]];
      if (role === "inverter") return [["Temperature", this._formatTemp(d.inverterTemp)]];
      return [];
    }

    _inverterSvg() {
      const uid = this._uid;
      return `
        <svg viewBox="0 0 200 145" role="img" aria-label="Inverter">
          <defs>
            <linearGradient id="vnpInvFront_${uid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#eef4ef"></stop><stop offset="1" stop-color="#ced8d2"></stop></linearGradient>
            <linearGradient id="vnpInvSide_${uid}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#3c4548"></stop><stop offset="1" stop-color="#1f2528"></stop></linearGradient>
            <linearGradient id="vnpInvPanel_${uid}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2a2d31"></stop><stop offset="1" stop-color="#101215"></stop></linearGradient>
          </defs>
          <g filter="drop-shadow(0 12px 14px rgba(0,0,0,.32))">
            <path d="M45 17 L151 11 L176 32 L176 116 L70 127 L45 104 Z" fill="url(#vnpInvSide_${uid})"></path>
            <path d="M24 24 Q24 15 33 15 L145 15 Q154 15 154 24 L154 108 Q154 117 145 117 L33 117 Q24 117 24 108 Z" fill="url(#vnpInvFront_${uid})" stroke="rgba(255,255,255,.82)" stroke-width="2"></path>
            <path d="M154 24 L176 41 L176 116 L154 108 Z" fill="url(#vnpInvSide_${uid})"></path>
            <circle cx="39" cy="30" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="139" cy="28" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="39" cy="101" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="139" cy="101" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <rect x="50" y="68" width="88" height="39" rx="7" fill="url(#vnpInvPanel_${uid})" stroke="rgba(255,255,255,.78)" stroke-width="1.7"></rect>
            <rect x="50" y="68" width="88" height="8" rx="7" fill="#72c936"></rect>
            <rect x="70" y="81" width="36" height="18" rx="2" fill="rgba(134,145,144,.48)"></rect>
            <circle cx="124" cy="80" r="2.4" fill="#8bd84f"></circle><circle cx="124" cy="90" r="2.4" fill="#8bd84f"></circle><circle cx="124" cy="100" r="2.4" fill="#ef5350"></circle>
            <path d="M68 105 H110" stroke="rgba(255,255,255,.75)" stroke-width="2.2" stroke-linecap="round"></path>
            <rect x="75" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect><rect x="86" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect><rect x="97" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect>
          </g>
        </svg>
      `;
    }

    _batterySvg(soc) {
      const level = this._batterySoc(soc);
      const shellY = 24;
      const shellH = 76;
      const fillH = shellH * (level / 100);
      const fillY = shellY + shellH - fillH;
      const color = this._socColor(soc);
      const uid = this._uid;

      return `
        <svg viewBox="0 0 120 120" role="img" aria-label="Battery">
          <defs><clipPath id="vnpBattClip_${uid}"><rect x="39" y="29" width="42" height="68" rx="7"></rect></clipPath></defs>
          <g filter="drop-shadow(0 10px 12px rgba(0,0,0,.24))">
            <rect x="45" y="11" width="30" height="12" rx="4" fill="rgba(255,255,255,.48)"></rect>
            <rect x="33" y="23" width="54" height="80" rx="12" fill="rgba(0,0,0,.24)" stroke="rgba(240,240,240,.85)" stroke-width="4"></rect>
            <g clip-path="url(#vnpBattClip_${uid})">
              <rect x="39" y="${fillY}" width="42" height="${fillH}" fill="${color}"></rect>
              <path d="M39 44 H81 M39 60 H81 M39 76 H81" stroke="rgba(255,255,255,.20)" stroke-width="2"></path>
            </g>
            <path d="M53 45 L66 45 L59 59 L72 59 L53 84 L59 65 L48 65 Z" fill="rgba(255,255,255,.88)"></path>
          </g>
        </svg>
      `;
    }

    _pylonSvg(mode) {
      const importOpacity = mode === "import" ? "1" : ".28";
      const exportOpacity = mode === "export" ? "1" : ".28";
      return `
        <svg viewBox="0 0 130 96" role="img" aria-label="Grid pylon">
          <g fill="none" stroke="rgba(220,226,234,.90)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M34 88 L51 15 L68 88"></path><path d="M42 49 H60"></path><path d="M39 64 H63"></path><path d="M51 15 L30 31 H72 Z"></path><path d="M42 49 L63 64"></path><path d="M60 49 L39 64"></path>
            <path d="M85 88 L96 36 L107 88"></path><path d="M90 58 H102"></path><path d="M96 36 L82 47 H110 Z"></path><path d="M8 31 C27 25 46 25 65 31 C84 37 103 37 122 31"></path>
          </g>
          <g font-size="15" font-weight="900" text-anchor="middle"><text x="41" y="14" fill="var(--vnp-export)" opacity="${exportOpacity}">←</text><text x="92" y="14" fill="var(--vnp-grid)" opacity="${importOpacity}">→</text></g>
        </svg>
      `;
    }

    _homeSvg() {
      const uid = this._uid;
      return `
        <svg viewBox="0 0 150 108" role="img" aria-label="Home">
          <defs>
            <linearGradient id="vnpHomeWall_${uid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(244,248,250,.96)"></stop><stop offset="1" stop-color="rgba(177,193,205,.84)"></stop></linearGradient>
            <linearGradient id="vnpHomeRoof_${uid}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="rgba(79,195,247,.95)"></stop><stop offset="1" stop-color="rgba(32,92,128,.95)"></stop></linearGradient>
          </defs>
          <g filter="drop-shadow(0 8px 10px rgba(0,0,0,.24))">
            <path d="M22 53 L75 15 L128 53 L118 64 L75 32 L32 64 Z" fill="url(#vnpHomeRoof_${uid})" stroke="rgba(255,255,255,.56)" stroke-width="2"></path>
            <path d="M38 57 H112 V92 H38 Z" fill="url(#vnpHomeWall_${uid})" stroke="rgba(255,255,255,.58)" stroke-width="2"></path>
            <rect x="98" y="29" width="12" height="21" rx="2" fill="rgba(45,67,80,.86)"></rect><path d="M96 29 H112" stroke="rgba(255,255,255,.50)" stroke-width="3" stroke-linecap="round"></path>
            <rect x="66" y="70" width="18" height="22" rx="2" fill="rgba(54,72,84,.78)"></rect><circle cx="80" cy="82" r="1.5" fill="rgba(255,255,255,.78)"></circle>
            <rect x="48" y="66" width="13" height="12" rx="2" fill="rgba(79,195,247,.58)"></rect><rect x="90" y="66" width="13" height="12" rx="2" fill="rgba(79,195,247,.58)"></rect>
            <path d="M32 92 H118" stroke="rgba(255,255,255,.50)" stroke-width="4" stroke-linecap="round"></path>
          </g>
        </svg>
      `;
    }
  }

  function ensureEditorDefined() {
    if (customElements.get(EDITOR_TAG)) return;

    customElements.define(
      EDITOR_TAG,
      class VNPowerFlowCardEditor extends HTMLElement {
        setConfig(config) {
          this._config = { ...(config || {}) };
          this._render();
        }

        set hass(hass) {
          this._hass = hass;
        }

        _render() {
          const c = this._config || {};
          const fields = [
            ["pv_power", "PV total power"],
            ["pv1_power", "PV string 1"],
            ["pv2_power", "PV string 2"],
            ["pv_expected_power", "PV expected power"],
            ["pv_sky_state", "Sky state entity"],
            ["sun_entity", "Sun entity"],
            ["home_power", "Home power"],
            ["today_load", "Today load energy"],
            ["grid_power", "Grid power"],
            ["grid_import_energy", "Grid import energy"],
            ["grid_export_energy", "Grid export energy"],
            ["battery_power", "Battery power"],
            ["battery_soc", "Battery SOC"],
            ["battery_voltage", "Battery voltage"],
            ["battery_current", "Battery current"],
            ["battery_temp1", "Battery temp 1"],
            ["battery_temp2", "Battery temp 2"],
            ["today_batt_chg", "Today battery charge"],
            ["batt_dis", "Today battery discharge"],
            ["inv_temp", "Inverter temperature"],
            ["max_power_w", "Max power W"],
            ["threshold_w", "Flow threshold W"],
          ];

          this.innerHTML = `
            <style>
              .vnp-editor { display: grid; gap: 10px; padding: 4px 0 8px; font-family: var(--primary-font-family, inherit); }
              .vnp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
              label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color, #9aa7b2); }
              span { font-size: 11px; font-weight: 600; }
              input, select { box-sizing: border-box; width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(255,255,255,.18)); background: var(--card-background-color, rgba(0,0,0,.2)); color: var(--primary-text-color, #fff); font-size: 13px; outline: none; }
              input:focus, select:focus { border-color: var(--primary-color, #ffb300); }
              @media (max-width: 620px) { .vnp-grid { grid-template-columns: 1fr; } }
            </style>
            <div class="vnp-editor">
              <div class="vnp-grid">
                ${fields.map(([key, label]) => this._field(key, label, c[key] || "")).join("")}
                ${this._fieldSelect("grid_positive_direction", "Grid positive direction", c.grid_positive_direction, [["import", "Import"], ["export", "Export"]])}
                ${this._fieldSelect("battery_positive_direction", "Battery positive direction", c.battery_positive_direction, [["discharge", "Discharge"], ["charge", "Charge"]])}
                ${this._fieldSelect("cloud_mode", "Cloud mode", c.cloud_mode, [["entity", "Entity"], ["auto", "Auto"], ["off", "Off"]])}
                ${this._fieldSelect("sky_state_override", "Sky state override", c.sky_state_override, [["off", "Off"], ["clear", "Clear"], ["partly_cloudy", "Partly cloudy"], ["cloudy", "Cloudy"], ["overcast", "Overcast"], ["rainy", "Rainy"], ["snow", "Snow"], ["snow_or_blocked", "Snow / blocked"]])}
                ${this._fieldSelect("show_clouds", "Show clouds", c.show_clouds, [["true", "Yes"], ["false", "No"]])}
                ${this._fieldSelect("show_snow", "Show snow", c.show_snow, [["true", "Yes"], ["false", "No"]])}
                ${this._fieldSelect("show_details", "Show details", c.show_details, [["true", "Yes"], ["false", "No"]])}
              </div>
            </div>
          `;

          this.querySelectorAll("input, select").forEach((el) => {
            el.addEventListener("change", () => this._valueChanged(el.dataset.key, el.value));
          });
        }

        _field(key, label, value) {
          return `<label><span>${label}</span><input data-key="${key}" value="${this._escapeAttrValue(value)}"></label>`;
        }

        _fieldSelect(key, label, value, options) {
          const opts = options.map(([val, text]) => `<option value="${val}" ${this._selected(value, val)}>${text}</option>`).join("");
          return `<label><span>${label}</span><select data-key="${key}">${opts}</select></label>`;
        }

        _selected(value, expected) {
          const actual = value === undefined || value === null || value === "" ? undefined : String(value);
          if (actual === undefined && ["entity", "off", "import", "discharge", "true"].includes(expected)) return "selected";
          return actual === expected ? "selected" : "";
        }

        _valueChanged(key, value) {
          const newConfig = { ...(this._config || {}) };
          if (value === "" || value === null || value === undefined) delete newConfig[key];
          else newConfig[key] = value;
          this._config = newConfig;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
        }

        _escapeAttrValue(value) {
          return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
      }
    );
  }

  if (!customElements.get(CARD_TAG)) {
    customElements.define(CARD_TAG, VNPowerFlowCard);
  }

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TAG,
    name: "VN Power Flow Card",
    description: "Real-time power flow card for Home Assistant",
    preview: true,
  });

  console.info(
    `%c VN Power Flow Card %c v${CARD_VERSION} `,
    "color: #ffb300; font-weight: 700;",
    "color: inherit;"
  );
})();
