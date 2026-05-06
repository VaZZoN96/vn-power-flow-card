/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * Version: 0.7.0
 */

(() => {
  const CARD_VERSION = "0.7.0";
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

  class VNPowerFlowCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
      this._hass = null;
    }

    static getStubConfig() {
      return {
        type: `custom:${CARD_TAG}`,
        title: "VN Power Flow",

        pv_power: "sensor.pv_power",
        home_power: "sensor.home_power",
        grid_power: "sensor.grid_power",
        battery_power: "sensor.battery_power",
        battery_soc: "sensor.battery_soc",

        sun_entity: "sun.sun",

        cloud_mode: "auto",
        pv_sky_state: "sensor.pv_sky_state",
        weather_entity: "weather.home",
        cloud_coverage_entity: "sensor.cloud_coverage",
        cloud_coverage_threshold: 55,

        grid_positive_direction: "import",
        battery_positive_direction: "discharge",

        threshold_w: 30,
        max_power_w: 10000,

        show_clouds: true,
        show_snow: true,
        show_header: true,
        show_details: true,
      };
    }

    static getConfigElement() {
      ensureEditorDefined();
      return document.createElement(EDITOR_TAG);
    }

    setConfig(config) {
      if (!config) {
        throw new Error("Invalid configuration");
      }

      this._config = {
        title: "VN Power Flow",
        threshold_w: 30,
        max_power_w: 10000,

        cloud_mode: "auto",
        show_clouds: true,
        show_snow: true,
        cloud_coverage_threshold: 55,

        show_header: true,
        show_details: true,

        grid_positive_direction: "import",
        battery_positive_direction: "discharge",

        ...config,
      };

      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
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

    _render() {
      if (!this.shadowRoot || !this._config) return;

      const c = this._config;
      const names = { ...DEFAULT_NAMES, ...(c.names || {}) };

      const threshold = this._number(c.threshold_w, 30);
      const maxPower = Math.max(this._number(c.max_power_w, 10000), 1000);

      const pv1W = Math.max(0, this._readPower(c.pv1_power));
      const pv2W = Math.max(0, this._readPower(c.pv2_power));
      const pvConfiguredW = this._readPower(c.pv_total_power || c.pv_power);
      const pvW = Math.max(0, pvConfiguredW || pv1W + pv2W);

      const homeW = Math.max(0, this._readPower(c.home_power || c.consump));

      const gridRawW = this._readPower(
        c.grid_power || c.grid_active_power || c.grid_power_alt
      );

      const batteryRawW = this._readPower(c.battery_power);

      const batterySoc = this._firstNumber([
        c.battery_soc,
        c.goodwe_battery_soc,
      ]);

      const batteryCurrent = this._firstNumber([
        c.battery_current,
        c.goodwe_battery_curr,
      ]);

      const batteryVoltage = this._readNumber(c.battery_voltage);

      const batteryTemp1 = this._readNumber(c.battery_temp1);
      const batteryTemp2 = this._readNumber(c.battery_temp2);
      const batteryMos = this._readNumber(c.battery_mos);
      const batteryMinCell = this._readNumber(c.battery_min_cell);
      const batteryMaxCell = this._readNumber(c.battery_max_cell);
      const batteryRemCap = this._readNumber(c.battery_rem_cap);

      const todayPv = this._readNumber(c.today_pv);
      const todayBattCharge = this._readNumber(c.today_batt_chg);
      const todayBattDischarge = this._readNumber(c.batt_dis);
      const todayLoad = this._readNumber(c.today_load);
      const gridImportEnergy = this._readNumber(c.grid_import_energy);
      const inverterTemp = this._readNumber(c.inv_temp);

      const gridPositiveDirection = String(
        c.grid_positive_direction || "import"
      ).toLowerCase();

      const batteryPositiveDirection = String(
        c.battery_positive_direction || "discharge"
      ).toLowerCase();

      const gridImportW =
        gridPositiveDirection === "import"
          ? Math.max(0, gridRawW)
          : Math.max(0, -gridRawW);

      const gridExportW =
        gridPositiveDirection === "import"
          ? Math.max(0, -gridRawW)
          : Math.max(0, gridRawW);

      const batteryDischargeW =
        batteryPositiveDirection === "discharge"
          ? Math.max(0, batteryRawW)
          : Math.max(0, -batteryRawW);

      const batteryChargeW =
        batteryPositiveDirection === "discharge"
          ? Math.max(0, -batteryRawW)
          : Math.max(0, batteryRawW);

      const skyState = this._skyState(c);

      const showClouds =
        this._bool(c.show_clouds, true) && CLOUDY_STATES.has(skyState);

      const showSnow =
        this._bool(c.show_snow, true) && SNOW_STATES.has(skyState);

      const sun = this._sunData(c.sun_entity || "sun.sun");
      const missingEntities = this._missingEntities(c, this._hass);

      const flows = {
        sunToPv: pvW > threshold && !sun.night,
        pvToInverter: pvW > threshold,
        inverterToHome: homeW > threshold,
        gridImport: gridImportW > threshold,
        gridExport: gridExportW > threshold,
        batteryCharge: batteryChargeW > threshold,
        batteryDischarge: batteryDischargeW > threshold,
      };

      const activePower =
        pvW +
        homeW +
        gridImportW +
        gridExportW +
        batteryChargeW +
        batteryDischargeW;

      const status = activePower > threshold ? "FLOW" : "IDLE";

      const gridMode = flows.gridImport
        ? "import"
        : flows.gridExport
          ? "export"
          : "idle";

      const batteryMode = flows.batteryCharge
        ? "charge"
        : flows.batteryDischarge
          ? "discharge"
          : "idle";

      const gridDirectionLabel =
        gridMode === "import"
          ? "Import →"
          : gridMode === "export"
            ? "← Export"
            : "Idle";

      const batteryDirectionLabel =
        batteryMode === "charge"
          ? "Charge →"
          : batteryMode === "discharge"
            ? "← Discharge"
            : "Idle";

      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>

        <ha-card>
          <div class="vnp-card">
            ${
              this._bool(c.show_header, true)
                ? `
                  <div class="vnp-topbar">
                    <div class="vnp-title-wrap">
                      <div class="vnp-title">⚡ ${this._escape(c.title || "VN Power Flow")}</div>
                      <div class="vnp-subtitle">Real-time power flow card for Home Assistant</div>
                    </div>
                    <div class="vnp-status ${status === "FLOW" ? "vnp-status-flow" : ""}">${status}</div>
                  </div>
                `
                : ""
            }

            ${missingEntities.length ? this._warning(missingEntities) : ""}

            <div class="vnp-stage vnp-sky-${this._escapeAttr(skyState)}">
              <section class="vnp-sky" aria-label="Sun trajectory">
                <svg class="vnp-sky-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path class="vnp-sun-arc" d="${this._sunArcPath(sun.noonY)}"></path>
                  <line class="vnp-horizon" x1="6" y1="86" x2="94" y2="86"></line>
                  <circle class="vnp-tick" cx="8" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="50" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="92" cy="86" r="1.1"></circle>
                </svg>

                <svg class="vnp-sky-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path
                    class="vnp-sky-flow ${this._flowClass(flows.sunToPv)}"
                    style="--duration:${this._flowDuration(pvW, maxPower)}s;"
                    d="${this._sunConnectorPath(sun.x, sun.y)}"
                  ></path>
                </svg>

                <div class="vnp-time vnp-time-rise">${this._escape(sun.rise)}</div>
                <div class="vnp-time vnp-time-noon">12:00</div>
                <div class="vnp-time vnp-time-set">${this._escape(sun.set)}</div>

                <div class="vnp-sun-marker ${sun.night ? "vnp-moon" : ""}" style="--sun-x:${sun.x}; --sun-y:${sun.y};">
                  <div class="vnp-sun-glow"></div>
                  <div class="vnp-sun-core">${sun.night ? "☾" : "☀"}</div>
                </div>

                <div class="vnp-cloud-layer ${showClouds ? "vnp-visible" : ""}">
                  <div class="vnp-cloud vnp-cloud-a"></div>
                  <div class="vnp-cloud vnp-cloud-b"></div>
                  <div class="vnp-cloud vnp-cloud-c"></div>
                </div>

                <div class="vnp-snow-layer ${showSnow ? "vnp-visible" : ""}">
                  <span>❄</span>
                  <span>❄</span>
                  <span>❄</span>
                  <span>❄</span>
                </div>
              </section>

              <section class="vnp-flow-area" aria-label="Power flow">
                <div
                  class="vnp-wire vnp-wire-vertical vnp-wire-sun ${flows.sunToPv ? "vnp-active" : ""}"
                  style="--wire-color: var(--vnp-sun); --duration:${this._flowDuration(pvW, maxPower)}s;"
                ></div>

                <div
                  class="vnp-wire vnp-wire-vertical vnp-wire-pv ${flows.pvToInverter ? "vnp-active" : ""}"
                  style="--wire-color: var(--vnp-pv); --duration:${this._flowDuration(pvW, maxPower)}s;"
                ></div>

                <div
                  class="vnp-wire vnp-wire-vertical vnp-wire-home ${flows.inverterToHome ? "vnp-active" : ""}"
                  style="--wire-color: var(--vnp-home); --duration:${this._flowDuration(homeW, maxPower)}s;"
                ></div>

                <div
                  class="vnp-wire vnp-wire-horizontal vnp-wire-grid ${
                    flows.gridImport || flows.gridExport ? "vnp-active" : ""
                  } ${flows.gridExport ? "vnp-reverse" : ""}"
                  style="--wire-color: ${flows.gridExport ? "var(--vnp-export)" : "var(--vnp-grid)"}; --duration:${this._flowDuration(Math.max(gridImportW, gridExportW), maxPower)}s;"
                ></div>

                <div
                  class="vnp-wire vnp-wire-horizontal vnp-wire-battery ${
                    flows.batteryCharge || flows.batteryDischarge ? "vnp-active" : ""
                  } ${flows.batteryDischarge ? "vnp-reverse" : ""}"
                  style="--wire-color: var(--vnp-battery); --duration:${this._flowDuration(Math.max(batteryChargeW, batteryDischargeW), maxPower)}s;"
                ></div>

                <div class="vnp-pv-badge">
                  <span>${this._escape(names.pv)}</span>
                  <strong>${this._formatPower(pvW)}</strong>
                  <small>${this._pvSubText(pv1W, pv2W, c)}</small>
                </div>

                <div class="vnp-inverter" aria-label="Inverter">
                  ${this._inverterSvg()}
                </div>

                <div class="vnp-grid-node vnp-grid-${gridMode}">
                  ${this._pylonSvg(gridMode)}
                  <div class="vnp-direction-chip">${gridDirectionLabel}</div>
                  <div class="vnp-side-value">${this._formatSignedPower(gridRawW)}</div>
                  <div class="vnp-side-sub">
                    ${
                      gridMode === "import"
                        ? this._formatPower(gridImportW)
                        : gridMode === "export"
                          ? this._formatPower(gridExportW)
                          : "0 W"
                    }
                  </div>
                </div>

                <div class="vnp-battery-node vnp-battery-${batteryMode}">
                  ${this._batterySvg(batterySoc)}
                  <div class="vnp-direction-chip">${batteryDirectionLabel}</div>
                  <div class="vnp-battery-value">${this._formatSignedPower(batteryRawW)}</div>
                  <div class="vnp-battery-sub">
                    ${Number.isFinite(batterySoc) ? `${Math.round(batterySoc)}%` : "--%"}
                    /
                    ${Number.isFinite(batteryVoltage) ? this._formatNumber(batteryVoltage, "V", 1) : "-- V"}
                    /
                    ${Number.isFinite(batteryCurrent) ? this._formatNumber(batteryCurrent, "A", 1) : "-- A"}
                  </div>
                </div>

                <div class="vnp-home-node">
                  ${this._homeSvg()}
                  <div class="vnp-home-value">${this._formatPower(homeW)}</div>
                  <div class="vnp-home-sub">${this._formatEnergy(todayLoad)}</div>
                </div>
              </section>
            </div>

            ${
              this._bool(c.show_details, true)
                ? `
                  <div class="vnp-details">
                    ${this._detailBox("Today PV", this._formatEnergy(todayPv), "☀️")}
                    ${this._detailBox("Batt Chg", this._formatEnergy(todayBattCharge), "↯")}
                    ${this._detailBox("Batt Dis.", this._formatEnergy(todayBattDischarge), "↯")}
                    ${this._detailBox("Grid Import", this._formatEnergy(gridImportEnergy), "⚡")}
                    ${this._detailBox("Inv Temp", this._formatTemp(inverterTemp), "🌡")}
                    ${this._detailBox("Temp 1", this._formatTemp(batteryTemp1), "🌡")}
                    ${this._detailBox("Temp 2", this._formatTemp(batteryTemp2), "🌡")}
                    ${this._detailBox("MOS Temp", this._formatTemp(batteryMos), "🌡")}
                    ${this._detailBox("Min Cell", this._formatNumberOrDash(batteryMinCell, "V", 3), "▮")}
                    ${this._detailBox("Max Cell", this._formatNumberOrDash(batteryMaxCell, "V", 3), "▮")}
                    ${this._detailBox("Remaining", this._formatNumberOrDash(batteryRemCap, "Ah", 0), "🔋")}
                  </div>
                `
                : ""
            }
          </div>
        </ha-card>
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
          background:
            radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.11), transparent 32%),
            var(--vnp-card-bg);
          color: var(--vnp-text);
        }

        .vnp-card {
          box-sizing: border-box;
          padding: 14px;
        }

        .vnp-topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .vnp-title-wrap {
          min-width: 0;
        }

        .vnp-title {
          overflow: hidden;
          font-size: 18px;
          font-weight: 800;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-subtitle {
          margin-top: 3px;
          color: var(--vnp-muted);
          font-size: 12px;
          line-height: 1.25;
        }

        .vnp-status {
          flex: 0 0 auto;
          border: 1px solid var(--vnp-border);
          border-radius: 999px;
          padding: 6px 11px;
          background: rgba(255,255,255,.08);
          color: var(--vnp-muted);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .06em;
        }

        .vnp-status-flow {
          color: var(--vnp-sun);
          box-shadow: 0 0 22px rgba(255,213,79,.20);
        }

        .vnp-warning {
          border: 1px solid rgba(255,193,7,.38);
          background: rgba(255,193,7,.11);
          border-radius: 12px;
          padding: 9px 10px;
          margin: 0 0 10px;
          font-size: 12px;
          line-height: 1.35;
        }

        .vnp-stage {
          overflow: hidden;
          border: 1px solid var(--vnp-border);
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(31,42,56,.92), rgba(10,15,22,.55));
        }

        .vnp-stage.vnp-sky-clear {
          background:
            radial-gradient(circle at 50% 8%, rgba(255,213,79,.18), transparent 28%),
            linear-gradient(180deg, rgba(30,51,72,.92), rgba(10,15,22,.52));
        }

        .vnp-stage.vnp-sky-night {
          background:
            radial-gradient(circle at 50% 8%, rgba(144,202,249,.14), transparent 28%),
            linear-gradient(180deg, rgba(9,17,32,.96), rgba(4,7,14,.68));
        }

        .vnp-sky {
          position: relative;
          height: 150px;
          border-bottom: 1px solid rgba(255,255,255,.09);
        }

        .vnp-sky-svg,
        .vnp-sky-flow-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .vnp-sun-arc {
          fill: none;
          stroke: rgba(255,213,79,.66);
          stroke-width: 1.1;
          stroke-dasharray: 3 3;
          vector-effect: non-scaling-stroke;
        }

        .vnp-sky-flow {
          fill: none;
          stroke: var(--vnp-sun);
          stroke-width: 2.1;
          stroke-dasharray: 8 8;
          opacity: 0.18;
          vector-effect: non-scaling-stroke;
        }

        .vnp-sky-flow.vnp-active {
          opacity: 0.95;
          animation: vnpDash var(--duration, 1.9s) linear infinite;
        }

        .vnp-sky-flow.vnp-inactive {
          stroke-dasharray: none;
        }

        .vnp-horizon {
          stroke: rgba(255,255,255,.16);
          stroke-width: .9;
          vector-effect: non-scaling-stroke;
        }

        .vnp-tick {
          fill: rgba(255,255,255,.45);
        }

        .vnp-time {
          position: absolute;
          bottom: 14px;
          transform: translateX(-50%);
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .vnp-time-rise { left: 8%; }
        .vnp-time-noon { left: 50%; }
        .vnp-time-set { left: 92%; }

        .vnp-sun-marker {
          position: absolute;
          left: calc(var(--sun-x) * 1%);
          top: calc(var(--sun-y) * 1%);
          z-index: 7;
          width: 48px;
          height: 48px;
          transform: translate(-50%, -50%);
        }

        .vnp-sun-glow {
          position: absolute;
          inset: 4px;
          border-radius: 999px;
          background:
            radial-gradient(circle, rgba(255,244,179,.38), rgba(255,213,79,.11) 48%, transparent 74%);
          box-shadow: 0 0 15px rgba(255,213,79,.22);
        }

        .vnp-sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 32px;
          height: 32px;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255,213,79,.17);
          box-shadow: 0 0 10px rgba(255,213,79,.24);
          font-size: 22px;
        }

        .vnp-moon .vnp-sun-glow {
          background: radial-gradient(circle, rgba(144,202,249,.24), transparent 72%);
          box-shadow: 0 0 14px rgba(144,202,249,.18);
        }

        .vnp-moon .vnp-sun-core {
          background: rgba(144,202,249,.12);
          box-shadow: 0 0 14px rgba(144,202,249,.24);
        }

        .vnp-cloud-layer {
          position: absolute;
          z-index: 8;
          left: 28%;
          top: 46%;
          width: 44%;
          height: 38%;
          opacity: 0;
          pointer-events: none;
          transition: opacity .35s ease;
        }

        .vnp-cloud-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-cloud {
          position: absolute;
          width: 32%;
          height: 28%;
          border-radius: 999px;
          background: rgba(236,239,241,.84);
          box-shadow: 0 0 12px rgba(255,255,255,.16);
          animation: vnpCloud 10s ease-in-out infinite alternate;
        }

        .vnp-cloud::before,
        .vnp-cloud::after {
          content: "";
          position: absolute;
          bottom: 30%;
          border-radius: 999px;
          background: inherit;
        }

        .vnp-cloud::before {
          left: 14%;
          width: 42%;
          height: 110%;
        }

        .vnp-cloud::after {
          left: 48%;
          width: 54%;
          height: 135%;
        }

        .vnp-cloud-a { left: 8%; top: 30%; }
        .vnp-cloud-b { left: 40%; top: 44%; transform: scale(.80); animation-duration: 12s; }
        .vnp-cloud-c { left: 60%; top: 10%; transform: scale(.68); opacity: .78; animation-duration: 14s; }

        @keyframes vnpCloud {
          from { margin-left: -2%; }
          to { margin-left: 4%; }
        }

        .vnp-snow-layer {
          position: absolute;
          z-index: 9;
          left: 36%;
          top: 50%;
          width: 28%;
          height: 44%;
          opacity: 0;
          pointer-events: none;
          transition: opacity .35s ease;
        }

        .vnp-snow-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-snow-layer span {
          position: absolute;
          top: 0;
          color: rgba(225,245,254,.95);
          animation: vnpSnow 3.8s linear infinite;
        }

        .vnp-snow-layer span:nth-child(1) { left: 8%; animation-delay: 0s; }
        .vnp-snow-layer span:nth-child(2) { left: 34%; animation-delay: .7s; }
        .vnp-snow-layer span:nth-child(3) { left: 62%; animation-delay: 1.4s; }
        .vnp-snow-layer span:nth-child(4) { left: 88%; animation-delay: 2.1s; }

        @keyframes vnpSnow {
          from { transform: translateY(0) rotate(0deg); opacity: 0; }
          20% { opacity: 1; }
          to { transform: translateY(58px) rotate(180deg); opacity: 0; }
        }

        .vnp-flow-area {
          position: relative;
          min-height: 490px;
        }

        .vnp-wire {
          position: absolute;
          z-index: 1;
          border-radius: 999px;
          background: color-mix(in srgb, var(--wire-color), transparent 80%);
          overflow: hidden;
          opacity: 0.9;
        }

        .vnp-wire::after {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0;
        }

        .vnp-wire.vnp-active::after {
          opacity: 1;
          animation: vnpWireMove var(--duration, 1.8s) linear infinite;
        }

        .vnp-wire.vnp-reverse::after {
          animation-direction: reverse;
        }

        .vnp-wire-vertical {
          left: calc(50% - 3px);
          width: 6px;
        }

        .vnp-wire-horizontal {
          top: calc(49% - 3px);
          height: 6px;
        }

        .vnp-wire-vertical::after {
          background:
            repeating-linear-gradient(
              to bottom,
              var(--wire-color) 0 8px,
              transparent 8px 16px
            );
        }

        .vnp-wire-horizontal::after {
          background:
            repeating-linear-gradient(
              to right,
              var(--wire-color) 0 8px,
              transparent 8px 16px
            );
        }

        .vnp-wire-sun {
          top: 0;
          height: 20%;
        }

        .vnp-wire-pv {
          top: 24%;
          height: 19%;
        }

        .vnp-wire-home {
          top: 56%;
          height: 26%;
        }

        .vnp-wire-grid {
          left: 20%;
          width: 27%;
        }

        .vnp-wire-battery {
          left: 53%;
          width: 27%;
        }

        @keyframes vnpWireMove {
          from { background-position: 0 0; }
          to { background-position: 16px 16px; }
        }

        @keyframes vnpDash {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -16; }
        }

        .vnp-pv-badge,
        .vnp-inverter,
        .vnp-grid-node,
        .vnp-battery-node,
        .vnp-home-node {
          position: absolute;
          z-index: 3;
          box-sizing: border-box;
          transform: translate(-50%, -50%);
        }

        .vnp-pv-badge {
          left: 50%;
          top: 20%;
          width: clamp(112px, 23%, 152px);
          border: 1px solid rgba(255,213,79,.32);
          border-radius: 13px;
          background: rgba(255,179,0,.10);
          box-shadow: 0 0 18px rgba(255,179,0,.10);
          padding: 8px 10px;
          text-align: center;
          backdrop-filter: blur(7px);
        }

        .vnp-pv-badge span,
        .vnp-pv-badge small {
          display: block;
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-pv-badge strong {
          display: block;
          margin: 3px 0;
          color: var(--vnp-text);
          font-size: 18px;
          font-weight: 900;
          line-height: 1.05;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-inverter {
          left: 50%;
          top: 49%;
          width: clamp(145px, 26%, 195px);
          height: clamp(108px, 21%, 142px);
          display: grid;
          place-items: center;
          background: transparent;
        }

        .vnp-inverter svg {
          display: block;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        .vnp-grid-node,
        .vnp-battery-node {
          top: 49%;
          width: clamp(110px, 22%, 142px);
          min-height: 166px;
          border: 1px solid var(--vnp-border);
          border-radius: 16px;
          background: var(--vnp-panel);
          padding: 8px;
          text-align: center;
          backdrop-filter: blur(8px);
        }

        .vnp-grid-node {
          left: 17%;
        }

        .vnp-battery-node {
          left: 83%;
        }

        .vnp-grid-node svg {
          display: block;
          width: 100%;
          height: 82px;
          margin: 0 auto 4px;
        }

        .vnp-battery-node svg {
          display: block;
          width: 100%;
          height: 92px;
          margin: 0 auto 4px;
        }

        .vnp-direction-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 72px;
          border-radius: 999px;
          padding: 3px 7px;
          margin: 1px 0 5px;
          background: rgba(255,255,255,.08);
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
        }

        .vnp-grid-import .vnp-direction-chip {
          color: var(--vnp-grid);
          background: rgba(186,104,200,.13);
        }

        .vnp-grid-export .vnp-direction-chip {
          color: var(--vnp-export);
          background: rgba(38,198,218,.13);
        }

        .vnp-battery-charge .vnp-direction-chip,
        .vnp-battery-discharge .vnp-direction-chip {
          color: var(--vnp-battery);
          background: rgba(102,187,106,.13);
        }

        .vnp-side-value,
        .vnp-battery-value,
        .vnp-home-value {
          overflow: hidden;
          color: var(--vnp-text);
          font-size: 16px;
          font-weight: 900;
          line-height: 1.1;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-side-sub,
        .vnp-battery-sub,
        .vnp-home-sub {
          margin-top: 4px;
          overflow: hidden;
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 700;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-home-node {
          left: 50%;
          top: 84%;
          width: clamp(148px, 31%, 200px);
          border: 1px solid var(--vnp-border);
          border-radius: 18px;
          background: var(--vnp-panel);
          padding: 10px;
          text-align: center;
          backdrop-filter: blur(8px);
        }

        .vnp-home-node svg {
          display: block;
          width: 102px;
          height: 74px;
          margin: 0 auto 6px;
          overflow: visible;
        }

        .vnp-home-value {
          font-size: 18px;
        }

        .vnp-details {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }

        .vnp-detail {
          min-width: 0;
          border: 1px solid var(--vnp-border);
          border-radius: 13px;
          background: rgba(255,255,255,.055);
          padding: 8px;
        }

        .vnp-detail-icon {
          display: inline-block;
          margin-right: 4px;
          opacity: .9;
        }

        .vnp-detail-label {
          display: block;
          overflow: hidden;
          color: var(--vnp-muted);
          font-size: 11px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-detail-value {
          display: block;
          overflow: hidden;
          margin-top: 3px;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 620px) {
          .vnp-card { padding: 12px; }
          .vnp-subtitle { display: none; }
          .vnp-sky { height: 132px; }
          .vnp-flow-area { min-height: 530px; }

          .vnp-inverter {
            top: 47%;
            width: 126px;
            height: 98px;
          }

          .vnp-pv-badge {
            top: 18%;
            width: 116px;
          }

          .vnp-grid-node {
            left: 16%;
            top: 48%;
            width: 98px;
            min-height: 154px;
            padding: 7px;
          }

          .vnp-battery-node {
            left: 84%;
            top: 48%;
            width: 98px;
            min-height: 154px;
            padding: 7px;
          }

          .vnp-grid-node svg {
            height: 70px;
          }

          .vnp-battery-node svg {
            height: 84px;
          }

          .vnp-home-node {
            top: 84%;
            width: 152px;
          }

          .vnp-home-node svg {
            width: 86px;
            height: 64px;
          }

          .vnp-details {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 390px) {
          .vnp-title { font-size: 16px; }
          .vnp-status { padding: 6px 9px; font-size: 11px; }
          .vnp-flow-area { min-height: 540px; }

          .vnp-grid-node {
            left: 15%;
            width: 90px;
          }

          .vnp-battery-node {
            left: 85%;
            width: 90px;
          }

          .vnp-inverter {
            width: 116px;
            height: 90px;
          }

          .vnp-pv-badge {
            width: 108px;
          }

          .vnp-side-value,
          .vnp-battery-value,
          .vnp-home-value {
            font-size: 15px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vnp-wire.vnp-active::after,
          .vnp-sky-flow.vnp-active,
          .vnp-cloud,
          .vnp-snow-layer span {
            animation: none;
          }
        }
      `;
    }

    _detailBox(label, value, icon) {
      return `
        <div class="vnp-detail">
          <span class="vnp-detail-label">
            <span class="vnp-detail-icon">${icon}</span>${this._escape(label)}
          </span>
          <span class="vnp-detail-value">${this._escape(value)}</span>
        </div>
      `;
    }

    _warning(missingEntities) {
      return `
        <div class="vnp-warning">
          Missing or unavailable entities:
          ${missingEntities.map((e) => this._escape(e)).join(", ")}
        </div>
      `;
    }

    _missingEntities(config, hass) {
      if (!hass) return [];

      const keys = [
        "pv_power",
        "pv_total_power",
        "pv1_power",
        "pv2_power",

        "home_power",
        "consump",

        "grid_power",
        "grid_active_power",
        "grid_power_alt",

        "battery_power",
        "battery_soc",
        "goodwe_battery_soc",
        "battery_current",
        "goodwe_battery_curr",
        "battery_voltage",

        "battery_temp1",
        "battery_temp2",
        "battery_mos",
        "battery_min_cell",
        "battery_max_cell",
        "battery_rem_cap",

        "today_pv",
        "today_batt_chg",
        "batt_dis",
        "today_load",
        "grid_import_energy",
        "inv_temp",

        "sun_entity",
        "pv_sky_state",
        "weather_entity",
        "cloud_coverage_entity",
      ];

      return keys
        .map((key) => config[key])
        .filter((entity) => entity && !hass.states[entity]);
    }

    _skyState(config) {
      const mode = String(config.cloud_mode || "auto").toLowerCase();

      if (mode === "off") return "clear";

      const sunEntity = config.sun_entity || "sun.sun";
      const sunState = this._readState(sunEntity);
      const elevation = this._readAttributeNumber(sunEntity, "elevation");

      if (sunState === "below_horizon") return "night";
      if (Number.isFinite(elevation) && elevation < 6) return "low_sun";

      if ((mode === "entity" || mode === "auto") && config.pv_sky_state) {
        const entityState = this._readState(config.pv_sky_state);

        if (entityState && !["unknown", "unavailable"].includes(entityState)) {
          return this._normalizeSkyState(entityState);
        }
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

        if (weatherState && !["unknown", "unavailable"].includes(weatherState)) {
          return this._normalizeSkyState(weatherState);
        }
      }

      return "clear";
    }

    _normalizeSkyState(value) {
      const normalized = String(value || "unknown")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/-/g, "_");

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
        blocked: "blocked",
        low_sun: "low_sun",
        night: "night",
      };

      return map[normalized] || normalized || "unknown";
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
        const t = this._clamp(
          (now.getTime() - riseDate.getTime()) /
            (setDate.getTime() - riseDate.getTime()),
          0,
          1
        );

        const p = this._cubicPoint(
          t,
          { x: 8, y: 86 },
          { x: 25, y: noonY },
          { x: 75, y: noonY },
          { x: 92, y: 86 }
        );

        x = p.x;
        y = p.y;
      } else if (Number.isFinite(elevation) && elevation > 0) {
        const approxT = this._clamp(
          (now.getHours() + now.getMinutes() / 60 - 6) / 12,
          0,
          1
        );

        const p = this._cubicPoint(
          approxT,
          { x: 8, y: 86 },
          { x: 25, y: noonY },
          { x: 75, y: noonY },
          { x: 92, y: 86 }
        );

        x = p.x;
        y = p.y;
      } else {
        const minutes = now.getHours() * 60 + now.getMinutes();
        const t =
          minutes >= 18 * 60
            ? (minutes - 18 * 60) / (12 * 60)
            : (minutes + 6 * 60) / (12 * 60);

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
        return `${String(date.getHours()).padStart(2, "0")}:${String(
          date.getMinutes()
        ).padStart(2, "0")}`;
      } catch (error) {
        return fallback;
      }
    }

    _estimateNoonElevation(entityId, nextNoon) {
      const currentElevation = this._readAttributeNumber(entityId, "elevation");

      try {
        const noonDate = nextNoon ? new Date(nextNoon) : new Date();
        const day = this._dayOfYear(
          Number.isNaN(noonDate.getTime()) ? new Date() : noonDate
        );

        const latitude = this._hass?.config?.latitude;

        if (!Number.isFinite(latitude)) {
          return Number.isFinite(currentElevation)
            ? Math.max(currentElevation, 25)
            : 45;
        }

        const declination = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365);

        return this._clamp(90 - Math.abs(latitude - declination), 5, 75);
      } catch (error) {
        return Number.isFinite(currentElevation)
          ? Math.max(currentElevation, 25)
          : 45;
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
      const diff =
        date -
        start +
        (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000;

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
      return (
        2.8 -
        this._clamp(Math.abs(value) / maxPower, 0, 1) * 1.5
      ).toFixed(2);
    }

    _readPower(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return 0;

      const entity = this._hass.states[entityId];
      const raw = Number.parseFloat(String(entity.state).replace(",", "."));

      if (!Number.isFinite(raw)) return 0;

      const unit = String(entity.attributes?.unit_of_measurement || "")
        .trim()
        .toLowerCase();

      if (unit === "kw") return raw * 1000;
      if (unit === "mw") return raw * 1000000;

      return raw;
    }

    _readNumber(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) {
        return Number.NaN;
      }

      const raw = Number.parseFloat(
        String(this._hass.states[entityId].state).replace(",", ".")
      );

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
      if (!entityId || !this._hass || !this._hass.states[entityId]) {
        return Number.NaN;
      }

      const value = this._hass.states[entityId].attributes?.[attribute];
      const raw = Number.parseFloat(String(value).replace(",", "."));

      return Number.isFinite(raw) ? raw : Number.NaN;
    }

    _readState(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return "";

      return String(this._hass.states[entityId].state || "")
        .trim()
        .toLowerCase();
    }

    _formatPower(value) {
      const abs = Math.abs(value);

      if (!Number.isFinite(abs)) return "--";

      if (abs >= 1000) {
        return `${(abs / 1000).toFixed(abs >= 10000 ? 1 : 2)} kW`;
      }

      return `${Math.round(abs)} W`;
    }

    _formatSignedPower(value) {
      if (!Number.isFinite(value)) return "--";
      if (Math.abs(value) < 0.5) return "0 W";

      return `${value > 0 ? "+" : "-"}${this._formatPower(value)}`;
    }

    _formatEnergy(value) {
      return Number.isFinite(value)
        ? `${value.toFixed(value >= 10 ? 1 : 2)} kWh`
        : "-- kWh";
    }

    _formatTemp(value) {
      return Number.isFinite(value) ? `${value.toFixed(0)} °C` : "-- °C";
    }

    _formatNumber(value, unit, decimals) {
      return Number.isFinite(value)
        ? `${value.toFixed(decimals)} ${unit}`
        : `-- ${unit}`;
    }

    _formatNumberOrDash(value, unit, decimals) {
      return this._formatNumber(value, unit, decimals);
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

      return !["false", "0", "no", "off"].includes(
        String(value).toLowerCase()
      );
    }

    _clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    _escape(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    _escapeAttr(value) {
      return this._escape(value).replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    _inverterSvg() {
      return `
        <svg viewBox="0 0 200 145" role="img" aria-label="Inverter">
          <defs>
            <linearGradient id="vnpInvFront" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#eef4ef"></stop>
              <stop offset="1" stop-color="#ced8d2"></stop>
            </linearGradient>
            <linearGradient id="vnpInvSide" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#3c4548"></stop>
              <stop offset="1" stop-color="#1f2528"></stop>
            </linearGradient>
            <linearGradient id="vnpInvPanel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#2a2d31"></stop>
              <stop offset="1" stop-color="#101215"></stop>
            </linearGradient>
          </defs>

          <g filter="drop-shadow(0 12px 14px rgba(0,0,0,.32))">
            <path d="M45 17 L151 11 L176 32 L176 116 L70 127 L45 104 Z" fill="url(#vnpInvSide)"></path>
            <path d="M24 24 Q24 15 33 15 L145 15 Q154 15 154 24 L154 108 Q154 117 145 117 L33 117 Q24 117 24 108 Z" fill="url(#vnpInvFront)" stroke="rgba(255,255,255,.82)" stroke-width="2"></path>
            <path d="M154 24 L176 41 L176 116 L154 108 Z" fill="url(#vnpInvSide)"></path>

            <circle cx="39" cy="30" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="139" cy="28" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="39" cy="101" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="139" cy="101" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>

            <rect x="50" y="68" width="88" height="39" rx="7" fill="url(#vnpInvPanel)" stroke="rgba(255,255,255,.78)" stroke-width="1.7"></rect>
            <rect x="50" y="68" width="88" height="8" rx="7" fill="#72c936"></rect>

            <rect x="70" y="81" width="36" height="18" rx="2" fill="rgba(134,145,144,.48)"></rect>

            <circle cx="124" cy="80" r="2.4" fill="#8bd84f"></circle>
            <circle cx="124" cy="90" r="2.4" fill="#8bd84f"></circle>
            <circle cx="124" cy="100" r="2.4" fill="#ef5350"></circle>

            <path d="M68 105 H110" stroke="rgba(255,255,255,.75)" stroke-width="2.2" stroke-linecap="round"></path>
            <rect x="75" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect>
            <rect x="86" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect>
            <rect x="97" y="100" width="8" height="7" rx="1.4" fill="rgba(255,255,255,.22)"></rect>
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

      return `
        <svg viewBox="0 0 120 120" role="img" aria-label="Battery">
          <defs>
            <linearGradient id="vnpBattShell" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(255,255,255,.94)"></stop>
              <stop offset="1" stop-color="rgba(165,174,180,.72)"></stop>
            </linearGradient>
          </defs>

          <g filter="drop-shadow(0 10px 12px rgba(0,0,0,.24))">
            <rect x="45" y="11" width="30" height="12" rx="4" fill="rgba(255,255,255,.48)"></rect>
            <rect x="33" y="23" width="54" height="80" rx="12" fill="rgba(0,0,0,.24)" stroke="url(#vnpBattShell)" stroke-width="4"></rect>
            <clipPath id="vnpBattClip">
              <rect x="39" y="29" width="42" height="68" rx="7"></rect>
            </clipPath>
            <g clip-path="url(#vnpBattClip)">
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
            <path d="M34 88 L51 15 L68 88"></path>
            <path d="M42 49 H60"></path>
            <path d="M39 64 H63"></path>
            <path d="M51 15 L30 31 H72 Z"></path>
            <path d="M42 49 L63 64"></path>
            <path d="M60 49 L39 64"></path>
            <path d="M85 88 L96 36 L107 88"></path>
            <path d="M90 58 H102"></path>
            <path d="M96 36 L82 47 H110 Z"></path>
            <path d="M8 31 C27 25 46 25 65 31 C84 37 103 37 122 31"></path>
          </g>

          <g font-size="15" font-weight="900" text-anchor="middle">
            <text x="41" y="14" fill="var(--vnp-export)" opacity="${exportOpacity}">←</text>
            <text x="92" y="14" fill="var(--vnp-grid)" opacity="${importOpacity}">→</text>
          </g>
        </svg>
      `;
    }

    _homeSvg() {
      return `
        <svg viewBox="0 0 150 108" role="img" aria-label="Home consumption">
          <defs>
            <linearGradient id="vnpHomeWall" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(244,248,250,.96)"></stop>
              <stop offset="1" stop-color="rgba(177,193,205,.84)"></stop>
            </linearGradient>
            <linearGradient id="vnpHomeRoof" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(79,195,247,.95)"></stop>
              <stop offset="1" stop-color="rgba(32,92,128,.95)"></stop>
            </linearGradient>
          </defs>

          <g filter="drop-shadow(0 8px 10px rgba(0,0,0,.24))">
            <path d="M22 53 L75 15 L128 53 L118 64 L75 32 L32 64 Z" fill="url(#vnpHomeRoof)" stroke="rgba(255,255,255,.56)" stroke-width="2"></path>
            <path d="M38 57 H112 V92 H38 Z" fill="url(#vnpHomeWall)" stroke="rgba(255,255,255,.58)" stroke-width="2"></path>
            <rect x="98" y="29" width="12" height="21" rx="2" fill="rgba(45,67,80,.86)"></rect>
            <path d="M96 29 H112" stroke="rgba(255,255,255,.50)" stroke-width="3" stroke-linecap="round"></path>
            <rect x="66" y="70" width="18" height="22" rx="2" fill="rgba(54,72,84,.78)"></rect>
            <circle cx="80" cy="82" r="1.5" fill="rgba(255,255,255,.78)"></circle>
            <rect x="48" y="66" width="13" height="12" rx="2" fill="rgba(79,195,247,.58)"></rect>
            <rect x="90" y="66" width="13" height="12" rx="2" fill="rgba(79,195,247,.58)"></rect>
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

          this.innerHTML = `
            <style>
              .vnp-editor {
                display: grid;
                gap: 14px;
                padding: 8px 0;
              }

              .vnp-section {
                border: 1px solid var(--divider-color, rgba(255,255,255,.15));
                border-radius: 12px;
                padding: 12px;
                background: rgba(255,255,255,.03);
              }

              .vnp-section h3 {
                margin: 0 0 10px;
                font-size: 14px;
                font-weight: 700;
                color: var(--primary-text-color);
              }

              .vnp-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
              }

              .vnp-editor label {
                display: grid;
                gap: 4px;
                font-size: 12px;
                color: var(--secondary-text-color);
              }

              .vnp-editor input,
              .vnp-editor select {
                box-sizing: border-box;
                width: 100%;
                padding: 8px;
                border-radius: 8px;
                border: 1px solid var(--divider-color, #555);
                background: var(--card-background-color, #111);
                color: var(--primary-text-color, #fff);
              }

              .vnp-check {
                display: flex !important;
                grid-template-columns: none !important;
                flex-direction: row;
                align-items: center;
                gap: 8px !important;
                min-height: 36px;
              }

              .vnp-check input {
                width: auto;
              }

              .vnp-note {
                color: var(--secondary-text-color);
                font-size: 12px;
                line-height: 1.35;
                margin-top: 8px;
              }

              @media (max-width: 560px) {
                .vnp-grid {
                  grid-template-columns: 1fr;
                }
              }
            </style>

            <div class="vnp-editor">
              <div class="vnp-section">
                <h3>General</h3>
                <div class="vnp-grid">
                  ${this._field("title", "Title", c.title || "VN Power Flow")}
                  ${this._numberField("threshold_w", "Animation threshold W", c.threshold_w ?? 30)}
                  ${this._numberField("max_power_w", "Max power scale W", c.max_power_w ?? 10000)}
                  ${this._check("show_header", "Show header", c.show_header !== false)}
                  ${this._check("show_details", "Show detail tiles", c.show_details !== false)}
                </div>
              </div>

              <div class="vnp-section">
                <h3>PV / Solar</h3>
                <div class="vnp-grid">
                  ${this._field("pv_power", "PV total power entity", c.pv_power || "")}
                  ${this._field("pv_total_power", "Alternative PV total entity", c.pv_total_power || "")}
                  ${this._field("pv1_power", "PV string 1 entity", c.pv1_power || "")}
                  ${this._field("pv2_power", "PV string 2 entity", c.pv2_power || "")}
                  ${this._field("sun_entity", "Sun entity", c.sun_entity || "sun.sun")}
                </div>
                <div class="vnp-note">
                  Możesz użyć jednego sensora PV total albo dwóch stringów PV1/PV2. Jeśli ustawisz total, karta użyje total. Jeśli total jest pusty, karta zsumuje PV1 + PV2.
                </div>
              </div>

              <div class="vnp-section">
                <h3>Home consumption</h3>
                <div class="vnp-grid">
                  ${this._field("home_power", "Home power entity", c.home_power || "")}
                  ${this._field("consump", "Alternative home consumption entity", c.consump || "")}
                  ${this._field("today_load", "Today load energy entity", c.today_load || "")}
                </div>
              </div>

              <div class="vnp-section">
                <h3>Grid</h3>
                <div class="vnp-grid">
                  ${this._field("grid_power", "Grid power entity", c.grid_power || "")}
                  ${this._field("grid_active_power", "Alternative grid active power entity", c.grid_active_power || "")}
                  ${this._field("grid_power_alt", "Alternative grid power entity 2", c.grid_power_alt || "")}
                  ${this._field("grid_import_energy", "Grid import energy today/entity", c.grid_import_energy || "")}

                  <label>
                    Positive grid value means
                    <select data-key="grid_positive_direction">
                      <option value="import" ${this._selected(c.grid_positive_direction, "import")}>Import from grid</option>
                      <option value="export" ${this._selected(c.grid_positive_direction, "export")}>Export to grid</option>
                    </select>
                  </label>
                </div>
                <div class="vnp-note">
                  Jeśli Twój falownik pokazuje dodatnią moc przy poborze z sieci, wybierz “Import from grid”.
                  Jeśli dodatnia moc oznacza oddawanie do sieci, wybierz “Export to grid”.
                </div>
              </div>

              <div class="vnp-section">
                <h3>Battery</h3>
                <div class="vnp-grid">
                  ${this._field("battery_power", "Battery power entity", c.battery_power || "")}
                  ${this._field("battery_soc", "Battery SOC entity", c.battery_soc || "")}
                  ${this._field("goodwe_battery_soc", "Alternative battery SOC entity", c.goodwe_battery_soc || "")}
                  ${this._field("battery_voltage", "Battery voltage entity", c.battery_voltage || "")}
                  ${this._field("battery_current", "Battery current entity", c.battery_current || "")}
                  ${this._field("goodwe_battery_curr", "Alternative battery current entity", c.goodwe_battery_curr || "")}
                  ${this._field("today_batt_chg", "Today battery charge entity", c.today_batt_chg || "")}
                  ${this._field("batt_dis", "Today battery discharge entity", c.batt_dis || "")}

                  <label>
                    Positive battery value means
                    <select data-key="battery_positive_direction">
                      <option value="discharge" ${this._selected(c.battery_positive_direction, "discharge")}>Battery discharging</option>
                      <option value="charge" ${this._selected(c.battery_positive_direction, "charge")}>Battery charging</option>
                    </select>
                  </label>
                </div>
                <div class="vnp-note">
                  Jeśli dodatnia moc baterii oznacza oddawanie energii do domu/falownika, wybierz “Battery discharging”.
                  Jeśli dodatnia moc oznacza ładowanie baterii, wybierz “Battery charging”.
                </div>
              </div>

              <div class="vnp-section">
                <h3>Battery details</h3>
                <div class="vnp-grid">
                  ${this._field("battery_temp1", "Battery temperature 1", c.battery_temp1 || "")}
                  ${this._field("battery_temp2", "Battery temperature 2", c.battery_temp2 || "")}
                  ${this._field("battery_mos", "Battery MOS temperature", c.battery_mos || "")}
                  ${this._field("battery_min_cell", "Battery minimum cell voltage", c.battery_min_cell || "")}
                  ${this._field("battery_max_cell", "Battery maximum cell voltage", c.battery_max_cell || "")}
                  ${this._field("battery_rem_cap", "Battery remaining capacity", c.battery_rem_cap || "")}
                </div>
              </div>

              <div class="vnp-section">
                <h3>Inverter / daily values</h3>
                <div class="vnp-grid">
                  ${this._field("today_pv", "Today PV generation entity", c.today_pv || "")}
                  ${this._field("inv_temp", "Inverter temperature entity", c.inv_temp || "")}
                </div>
              </div>

              <div class="vnp-section">
                <h3>Clouds / sky state</h3>
                <div class="vnp-grid">
                  <label>
                    Cloud mode
                    <select data-key="cloud_mode">
                      <option value="auto" ${this._selected(c.cloud_mode, "auto")}>Auto</option>
                      <option value="entity" ${this._selected(c.cloud_mode, "entity")}>Entity</option>
                      <option value="off" ${this._selected(c.cloud_mode, "off")}>Off</option>
                    </select>
                  </label>

                  ${this._check("show_clouds", "Show clouds", c.show_clouds !== false)}
                  ${this._check("show_snow", "Show snow / blocked animation", c.show_snow !== false)}

                  ${this._field("pv_sky_state", "PV sky state entity", c.pv_sky_state || "")}
                  ${this._field("weather_entity", "Weather entity", c.weather_entity || "")}
                  ${this._field("cloud_coverage_entity", "Cloud coverage entity", c.cloud_coverage_entity || "")}
                  ${this._numberField("cloud_coverage_threshold", "Cloud coverage threshold %", c.cloud_coverage_threshold ?? 55)}
                </div>

                <div class="vnp-note">
                  Najlepszy tryb: cloud_mode = entity i własny sensor pv_sky_state.
                  Tryb auto działa tak: najpierw pv_sky_state, potem cloud_coverage_entity, potem weather_entity.
                </div>
              </div>

              <div class="vnp-section">
                <h3>Display names</h3>
                <div class="vnp-grid">
                  ${this._nameField("pv", "PV label", c.names?.pv || "PV")}
                  ${this._nameField("home", "Home label", c.names?.home || "Home")}
                  ${this._nameField("grid", "Grid label", c.names?.grid || "Grid")}
                  ${this._nameField("battery", "Battery label", c.names?.battery || "Battery")}
                  ${this._nameField("sun", "Sun label", c.names?.sun || "Sun")}
                </div>
              </div>

              <div class="vnp-note">
                Szerokość karty ustawiasz w układzie dashboardu. Karta zgłasza pełną szerokość w Sections view przez getGridOptions().
              </div>
            </div>
          `;

          this.querySelectorAll("input, select").forEach((el) => {
            el.addEventListener("change", () => {
              if (el.dataset.nameKey) {
                this._nameChanged(el.dataset.nameKey, el.value);
                return;
              }

              if (el.type === "checkbox") {
                this._valueChanged(el.dataset.key, el.checked);
                return;
              }

              if (el.type === "number") {
                const parsed = Number.parseFloat(el.value);
                this._valueChanged(el.dataset.key, Number.isFinite(parsed) ? parsed : "");
                return;
              }

              this._valueChanged(el.dataset.key, el.value);
            });
          });
        }

        _field(key, label, value) {
          return `
            <label>
              ${label}
              <input data-key="${key}" value="${this._escapeAttrValue(value)}">
            </label>
          `;
        }

        _numberField(key, label, value) {
          return `
            <label>
              ${label}
              <input type="number" data-key="${key}" value="${this._escapeAttrValue(value)}">
            </label>
          `;
        }

        _check(key, label, checked) {
          return `
            <label class="vnp-check">
              <input type="checkbox" data-key="${key}" ${checked ? "checked" : ""}>
              ${label}
            </label>
          `;
        }

        _nameField(nameKey, label, value) {
          return `
            <label>
              ${label}
              <input data-name-key="${nameKey}" value="${this._escapeAttrValue(value)}">
            </label>
          `;
        }

        _selected(value, expected) {
          const actual =
            value === undefined || value === null || value === ""
              ? undefined
              : String(value);

          if (actual === undefined) {
            if (
              expected === "auto" ||
              expected === "import" ||
              expected === "discharge"
            ) {
              return "selected";
            }
          }

          return actual === expected ? "selected" : "";
        }

        _valueChanged(key, value) {
          const newConfig = { ...(this._config || {}) };

          if (value === "" || value === null || value === undefined) {
            delete newConfig[key];
          } else {
            newConfig[key] = value;
          }

          this._config = newConfig;
          this._fireConfigChanged(newConfig);
        }

        _nameChanged(nameKey, value) {
          const newConfig = { ...(this._config || {}) };
          const names = { ...(newConfig.names || {}) };

          if (value === "" || value === null || value === undefined) {
            delete names[nameKey];
          } else {
            names[nameKey] = value;
          }

          if (Object.keys(names).length) {
            newConfig.names = names;
          } else {
            delete newConfig.names;
          }

          this._config = newConfig;
          this._fireConfigChanged(newConfig);
        }

        _fireConfigChanged(config) {
          this.dispatchEvent(
            new CustomEvent("config-changed", {
              detail: { config },
              bubbles: true,
              composed: true,
            })
          );
        }

        _escapeAttrValue(value) {
          return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
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
