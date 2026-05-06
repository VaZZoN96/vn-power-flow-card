/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * Layout v0.4.0
 */

(() => {
  const CARD_VERSION = "0.4.0";
  const CARD_TAG = "vn-power-flow-card";

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
        cloud_mode: "entity",
        pv_sky_state: "sensor.pv_sky_state",
        grid_positive_direction: "import",
        battery_positive_direction: "discharge",
        threshold_w: 30,
        max_power_w: 10000,
      };
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
        show_details: true,
        show_header: true,
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
        min_rows: 10,
        max_rows: 18,
      };
    }

    _render() {
      if (!this.shadowRoot || !this._config) return;

      const config = this._config;
      const hass = this._hass;
      const names = { ...DEFAULT_NAMES, ...(config.names || {}) };

      const threshold = this._number(config.threshold_w, 30);
      const maxPower = Math.max(this._number(config.max_power_w, 10000), 1000);

      const pv1W = Math.max(0, this._readPower(config.pv1_power));
      const pv2W = Math.max(0, this._readPower(config.pv2_power));
      const pvTotalConfigured = this._readPower(config.pv_total_power || config.pv_power);
      const pvW = Math.max(0, pvTotalConfigured || pv1W + pv2W);

      const homeW = Math.max(0, this._readPower(config.home_power || config.consump));
      const gridRawW = this._readPower(
        config.grid_power ||
        config.grid_active_power ||
        config.grid_power_alt
      );

      const batteryRawW = this._readPower(config.battery_power);
      const batterySoc = this._firstNumber([
        config.battery_soc,
        config.goodwe_battery_soc,
      ]);

      const batteryCurrent = this._firstNumber([
        config.battery_current,
        config.goodwe_battery_curr,
      ]);

      const batteryVoltage = this._readNumber(config.battery_voltage);
      const batteryTemp1 = this._readNumber(config.battery_temp1);
      const batteryTemp2 = this._readNumber(config.battery_temp2);
      const batteryMos = this._readNumber(config.battery_mos);
      const batteryMinCell = this._readNumber(config.battery_min_cell);
      const batteryMaxCell = this._readNumber(config.battery_max_cell);
      const batteryRemCap = this._readNumber(config.battery_rem_cap);

      const todayPv = this._readNumber(config.today_pv);
      const todayBattCharge = this._readNumber(config.today_batt_chg);
      const todayBattDischarge = this._readNumber(config.batt_dis);
      const todayLoad = this._readNumber(config.today_load);
      const gridImportEnergy = this._readNumber(config.grid_import_energy);
      const inverterTemp = this._readNumber(config.inv_temp);

      const gridPositiveDirection = String(config.grid_positive_direction || "import").toLowerCase();
      const batteryPositiveDirection = String(config.battery_positive_direction || "discharge").toLowerCase();

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

      const skyState = this._skyState(config);
      const showClouds = this._bool(config.show_clouds, true) && CLOUDY_STATES.has(skyState);
      const showSnow = this._bool(config.show_snow, true) && SNOW_STATES.has(skyState);
      const sun = this._sunData(config.sun_entity || "sun.sun");

      const activePower = pvW + homeW + gridImportW + gridExportW + batteryChargeW + batteryDischargeW;
      const status = activePower > threshold ? "FLOW" : "IDLE";

      const missingEntities = this._missingEntities(config, hass);

      const flows = {
        sunToPv: pvW > threshold && !sun.night,
        pvToInverter: pvW > threshold,
        inverterToHome: homeW > threshold,
        gridImport: gridImportW > threshold,
        gridExport: gridExportW > threshold,
        batteryCharge: batteryChargeW > threshold,
        batteryDischarge: batteryDischargeW > threshold,
      };

      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>

        <ha-card>
          <div class="vnp-card">
            ${
              this._bool(config.show_header, true)
                ? `
                  <div class="vnp-topbar">
                    <div class="vnp-title-wrap">
                      <div class="vnp-title">⚡ ${this._escape(config.title || "VN Power Flow")}</div>
                      <div class="vnp-subtitle">Real-time power flow card for Home Assistant</div>
                    </div>

                    <div class="vnp-status ${status === "FLOW" ? "vnp-status-flow" : ""}">
                      ${status}
                    </div>
                  </div>
                `
                : ""
            }

            ${missingEntities.length ? this._warning(missingEntities) : ""}

            <div class="vnp-stage vnp-sky-${this._escapeAttr(skyState)}">
              <section class="vnp-sky" aria-label="Sun trajectory">
                <svg class="vnp-sky-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path
                    class="vnp-sun-arc"
                    d="${this._sunArcPath(sun.noonY)}"
                  ></path>
                  <line class="vnp-horizon" x1="6" y1="86" x2="94" y2="86"></line>
                  <circle class="vnp-tick" cx="8" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="50" cy="86" r="1.1"></circle>
                  <circle class="vnp-tick" cx="92" cy="86" r="1.1"></circle>
                </svg>

                <div class="vnp-time vnp-time-rise">${this._escape(sun.rise)}</div>
                <div class="vnp-time vnp-time-noon">12:00</div>
                <div class="vnp-time vnp-time-set">${this._escape(sun.set)}</div>

                <div
                  class="vnp-sun-marker ${sun.night ? "vnp-moon" : ""}"
                  style="--sun-x:${sun.x}; --sun-y:${sun.y};"
                  title="${this._escapeAttr(names.sun)}"
                >
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
                <svg class="vnp-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <filter id="vnpGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="0.55" result="blur"></feGaussianBlur>
                      <feMerge>
                        <feMergeNode in="blur"></feMergeNode>
                        <feMergeNode in="SourceGraphic"></feMergeNode>
                      </feMerge>
                    </filter>
                  </defs>

                  <path
                    class="vnp-flow vnp-flow-sun ${this._flowClass(flows.sunToPv)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}; --duration:${this._flowDuration(pvW, maxPower)}s;"
                    d="M50 0 C50 8 50 13 50 20"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-pv ${this._flowClass(flows.pvToInverter)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}; --duration:${this._flowDuration(pvW, maxPower)}s;"
                    d="M50 24 C50 32 50 38 50 44"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-home ${this._flowClass(flows.inverterToHome)}"
                    style="--power:${this._flowStrength(homeW, maxPower)}; --duration:${this._flowDuration(homeW, maxPower)}s;"
                    d="M50 53 C50 64 50 73 50 83"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-grid ${this._flowClass(flows.gridImport)}"
                    style="--power:${this._flowStrength(gridImportW, maxPower)}; --duration:${this._flowDuration(gridImportW, maxPower)}s;"
                    d="M20 49 C31 49 39 49 47 49"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-export ${this._flowClass(flows.gridExport)} vnp-reverse"
                    style="--power:${this._flowStrength(gridExportW, maxPower)}; --duration:${this._flowDuration(gridExportW, maxPower)}s;"
                    d="M20 49 C31 49 39 49 47 49"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryCharge)}"
                    style="--power:${this._flowStrength(batteryChargeW, maxPower)}; --duration:${this._flowDuration(batteryChargeW, maxPower)}s;"
                    d="M53 49 C61 49 69 49 80 49"
                  ></path>

                  <path
                    class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryDischarge)} vnp-reverse"
                    style="--power:${this._flowStrength(batteryDischargeW, maxPower)}; --duration:${this._flowDuration(batteryDischargeW, maxPower)}s;"
                    d="M53 49 C61 49 69 49 80 49"
                  ></path>
                </svg>

                <div class="vnp-pv-badge">
                  <span>${this._escape(names.pv)}</span>
                  <strong>${this._formatPower(pvW)}</strong>
                  <small>${this._pvSubText(pv1W, pv2W, config)}</small>
                </div>

                <div class="vnp-inverter" title="Inverter">
                  ${this._inverterSvg()}
                </div>

                <div class="vnp-grid-node">
                  ${this._pylonSvg()}
                  <div class="vnp-side-value">${this._formatSignedPower(gridRawW)}</div>
                  <div class="vnp-side-sub">${gridImportW >= gridExportW ? "Import" : "Export"} ${gridImportW >= gridExportW ? this._formatPower(gridImportW) : this._formatPower(gridExportW)}</div>
                </div>

                <div class="vnp-battery-node">
                  <div class="vnp-battery-head">
                    <span>${this._escape(names.battery)}</span>
                    <strong>${Number.isFinite(batterySoc) ? `${Math.round(batterySoc)}%` : "--%"}</strong>
                  </div>
                  <div class="vnp-battery-shell">
                    <div class="vnp-battery-fill" style="--soc:${this._batterySoc(batterySoc)}%; --batt-color:${this._socColor(batterySoc)};"></div>
                    <div class="vnp-battery-text">
                      <strong>${this._formatSignedPower(batteryRawW)}</strong>
                      <span>${Number.isFinite(batteryVoltage) ? this._formatNumber(batteryVoltage, "V", 1) : "-- V"}</span>
                      <span>${Number.isFinite(batteryCurrent) ? this._formatNumber(batteryCurrent, "A", 1) : "-- A"}</span>
                    </div>
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
              this._bool(config.show_details, true)
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
          --vnp-panel-strong: rgba(255, 255, 255, 0.105);
          --vnp-sun: #ffd54f;
          --vnp-pv: #ffb300;
          --vnp-home: #4fc3f7;
          --vnp-grid: #ba68c8;
          --vnp-export: #26c6da;
          --vnp-battery: #66bb6a;
          --vnp-danger: #ff5252;
        }

        ha-card {
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 18px);
          background:
            radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.12), transparent 32%),
            radial-gradient(circle at 100% 30%, rgba(79, 195, 247, 0.10), transparent 30%),
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
          background: rgba(255, 255, 255, 0.08);
          color: var(--vnp-muted);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.06em;
        }

        .vnp-status-flow {
          color: #ffd54f;
          box-shadow: 0 0 22px rgba(255, 213, 79, 0.20);
        }

        .vnp-warning {
          border: 1px solid rgba(255, 193, 7, 0.38);
          background: rgba(255, 193, 7, 0.11);
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
            linear-gradient(180deg, rgba(31, 42, 56, 0.92), rgba(10, 15, 22, 0.55)),
            rgba(255, 255, 255, 0.03);
        }

        .vnp-stage.vnp-sky-clear {
          background:
            radial-gradient(circle at 50% 8%, rgba(255, 213, 79, 0.18), transparent 28%),
            linear-gradient(180deg, rgba(30, 51, 72, 0.92), rgba(10, 15, 22, 0.52));
        }

        .vnp-stage.vnp-sky-night {
          background:
            radial-gradient(circle at 50% 8%, rgba(144, 202, 249, 0.14), transparent 28%),
            linear-gradient(180deg, rgba(9, 17, 32, 0.96), rgba(4, 7, 14, 0.68));
        }

        .vnp-sky {
          position: relative;
          height: 150px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        }

        .vnp-sky-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .vnp-sun-arc {
          fill: none;
          stroke: rgba(255, 213, 79, 0.62);
          stroke-width: 1.1;
          stroke-dasharray: 3 3;
          vector-effect: non-scaling-stroke;
        }

        .vnp-horizon {
          stroke: rgba(255, 255, 255, 0.16);
          stroke-width: 0.9;
          vector-effect: non-scaling-stroke;
        }

        .vnp-tick {
          fill: rgba(255, 255, 255, 0.45);
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
          width: 52px;
          height: 52px;
          transform: translate(-50%, -50%);
        }

        .vnp-sun-glow {
          position: absolute;
          inset: 3px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(255, 244, 179, 0.40), rgba(255, 213, 79, 0.13) 45%, transparent 72%);
          box-shadow: 0 0 18px rgba(255, 213, 79, 0.22);
        }

        .vnp-sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 34px;
          height: 34px;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255, 213, 79, 0.20);
          box-shadow: 0 0 12px rgba(255, 213, 79, 0.30);
          font-size: 24px;
        }

        .vnp-moon .vnp-sun-glow {
          background: radial-gradient(circle, rgba(144, 202, 249, 0.24), transparent 72%);
          box-shadow: 0 0 14px rgba(144, 202, 249, 0.18);
        }

        .vnp-moon .vnp-sun-core {
          background: rgba(144, 202, 249, 0.12);
          box-shadow: 0 0 14px rgba(144, 202, 249, 0.24);
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
          transition: opacity 0.35s ease;
        }

        .vnp-cloud-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-cloud {
          position: absolute;
          width: 32%;
          height: 28%;
          border-radius: 999px;
          background: rgba(236, 239, 241, 0.84);
          box-shadow: 0 0 12px rgba(255, 255, 255, 0.16);
          animation: vnpCloud 9s ease-in-out infinite alternate;
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
        .vnp-cloud-b { left: 40%; top: 44%; transform: scale(0.80); animation-duration: 11s; }
        .vnp-cloud-c { left: 60%; top: 10%; transform: scale(0.68); opacity: 0.78; animation-duration: 13s; }

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
          transition: opacity 0.35s ease;
        }

        .vnp-snow-layer.vnp-visible { opacity: 1; }

        .vnp-snow-layer span {
          position: absolute;
          top: 0;
          color: rgba(225, 245, 254, 0.95);
          animation: vnpSnow 3.6s linear infinite;
        }

        .vnp-snow-layer span:nth-child(1) { left: 8%; animation-delay: 0s; }
        .vnp-snow-layer span:nth-child(2) { left: 34%; animation-delay: 0.7s; }
        .vnp-snow-layer span:nth-child(3) { left: 62%; animation-delay: 1.4s; }
        .vnp-snow-layer span:nth-child(4) { left: 88%; animation-delay: 2.1s; }

        @keyframes vnpSnow {
          from { transform: translateY(0) rotate(0deg); opacity: 0; }
          20% { opacity: 1; }
          to { transform: translateY(58px) rotate(180deg); opacity: 0; }
        }

        .vnp-flow-area {
          position: relative;
          min-height: 470px;
        }

        .vnp-flow-svg {
          position: absolute;
          inset: 0;
          z-index: 1;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .vnp-flow {
          fill: none;
          stroke: rgba(255, 255, 255, 0.18);
          stroke-width: calc(0.8px + (var(--power, 0.2) * 2.2px));
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 3 4;
          opacity: 0.24;
          vector-effect: non-scaling-stroke;
        }

        .vnp-flow.vnp-active {
          opacity: 0.96;
          filter: url(#vnpGlow);
          animation: vnpFlow var(--duration, 1.8s) linear infinite;
        }

        .vnp-flow.vnp-reverse {
          animation-direction: reverse;
        }

        .vnp-flow.vnp-inactive {
          stroke-dasharray: none;
        }

        .vnp-flow-sun { stroke: var(--vnp-sun); }
        .vnp-flow-pv { stroke: var(--vnp-pv); }
        .vnp-flow-home { stroke: var(--vnp-home); }
        .vnp-flow-grid { stroke: var(--vnp-grid); }
        .vnp-flow-export { stroke: var(--vnp-export); }
        .vnp-flow-battery { stroke: var(--vnp-battery); }

        @keyframes vnpFlow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -14; }
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
          width: clamp(108px, 23%, 148px);
          border: 1px solid rgba(255, 213, 79, 0.32);
          border-radius: 13px;
          background: rgba(255, 179, 0, 0.10);
          box-shadow: 0 0 18px rgba(255, 179, 0, 0.10);
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
          width: clamp(104px, 21%, 138px);
          height: clamp(92px, 19%, 122px);
          display: grid;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 18px;
          background:
            radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.12), transparent 58%),
            rgba(255, 255, 255, 0.07);
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.20);
          backdrop-filter: blur(8px);
        }

        .vnp-inverter svg,
        .vnp-grid-node svg,
        .vnp-home-node svg {
          display: block;
          width: 100%;
          height: auto;
        }

        .vnp-grid-node {
          left: 18%;
          top: 49%;
          width: clamp(104px, 22%, 132px);
          min-height: 148px;
          border: 1px solid var(--vnp-border);
          border-radius: 16px;
          background: var(--vnp-panel);
          padding: 8px;
          text-align: center;
          backdrop-filter: blur(8px);
        }

        .vnp-grid-node svg {
          height: 78px;
          margin: 0 auto 5px;
        }

        .vnp-side-value {
          overflow: hidden;
          color: var(--vnp-text);
          font-size: 16px;
          font-weight: 900;
          line-height: 1.1;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-side-sub {
          margin-top: 4px;
          overflow: hidden;
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 700;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-battery-node {
          left: 82%;
          top: 49%;
          width: clamp(106px, 22%, 136px);
        }

        .vnp-battery-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          color: var(--vnp-muted);
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .vnp-battery-head strong {
          color: var(--vnp-text);
          font-size: 13px;
        }

        .vnp-battery-shell {
          position: relative;
          height: 162px;
          overflow: hidden;
          border: 2px solid rgba(255, 255, 255, 0.25);
          border-radius: 18px;
          background: rgba(0, 0, 0, 0.22);
          box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.42);
        }

        .vnp-battery-shell::before {
          content: "";
          position: absolute;
          left: 50%;
          top: -7px;
          width: 38%;
          height: 7px;
          transform: translateX(-50%);
          border-radius: 6px 6px 0 0;
          background: rgba(255, 255, 255, 0.30);
        }

        .vnp-battery-fill {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: calc(var(--soc) * 1%);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent), var(--batt-color);
          transition: height 0.45s ease;
        }

        .vnp-battery-text {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: grid;
          place-content: center;
          gap: 4px;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
        }

        .vnp-battery-text strong {
          font-size: 17px;
          line-height: 1;
        }

        .vnp-battery-text span {
          color: rgba(255, 255, 255, 0.86);
          font-size: 11px;
        }

        .vnp-home-node {
          left: 50%;
          top: 84%;
          width: clamp(128px, 28%, 172px);
          border: 1px solid var(--vnp-border);
          border-radius: 18px;
          background: var(--vnp-panel);
          padding: 10px;
          text-align: center;
          backdrop-filter: blur(8px);
        }

        .vnp-home-node svg {
          width: 72px;
          height: 54px;
          margin: 0 auto 6px;
        }

        .vnp-home-value {
          color: var(--vnp-text);
          font-size: 18px;
          font-weight: 900;
          line-height: 1.1;
        }

        .vnp-home-sub {
          margin-top: 4px;
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 700;
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
          background: rgba(255, 255, 255, 0.055);
          padding: 8px;
        }

        .vnp-detail-icon {
          display: inline-block;
          margin-right: 4px;
          opacity: 0.9;
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
          .vnp-flow-area { min-height: 500px; }
          .vnp-pv-badge { top: 18%; width: 116px; }
          .vnp-inverter { top: 47%; width: 104px; height: 92px; }
          .vnp-grid-node { left: 16%; top: 48%; width: 96px; min-height: 132px; padding: 7px; }
          .vnp-grid-node svg { height: 66px; }
          .vnp-battery-node { left: 84%; top: 48%; width: 96px; }
          .vnp-battery-shell { height: 140px; }
          .vnp-home-node { top: 84%; width: 136px; }
          .vnp-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 390px) {
          .vnp-title { font-size: 16px; }
          .vnp-status { padding: 6px 9px; font-size: 11px; }
          .vnp-flow-area { min-height: 510px; }
          .vnp-grid-node { left: 15%; width: 88px; }
          .vnp-battery-node { left: 85%; width: 88px; }
          .vnp-inverter { width: 96px; height: 86px; }
          .vnp-pv-badge { width: 108px; }
          .vnp-side-value,
          .vnp-home-value { font-size: 15px; }
          .vnp-battery-text strong { font-size: 15px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vnp-flow.vnp-active,
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
          <span class="vnp-detail-label"><span class="vnp-detail-icon">${icon}</span>${this._escape(label)}</span>
          <span class="vnp-detail-value">${this._escape(value)}</span>
        </div>
      `;
    }

    _warning(missingEntities) {
      return `
        <div class="vnp-warning">
          Missing or unavailable entities: ${missingEntities.map((entity) => this._escape(entity)).join(", ")}
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
        "sun_entity",
        "pv_sky_state",
        "weather_entity",
      ];

      return keys
        .map((key) => config[key])
        .filter((entity) => entity && !hass.states[entity]);
    }

    _skyState(config) {
      const mode = String(config.cloud_mode || "auto").toLowerCase();

      if (mode === "off") return "clear";

      if ((mode === "entity" || mode === "auto") && config.pv_sky_state) {
        const entityState = this._readState(config.pv_sky_state);

        if (entityState && !["unknown", "unavailable"].includes(entityState)) {
          return this._normalizeSkyState(entityState);
        }
      }

      const sunEntity = config.sun_entity || "sun.sun";
      const sunState = this._readState(sunEntity);
      const elevation = this._readAttributeNumber(sunEntity, "elevation");

      if (sunState === "below_horizon") return "night";
      if (Number.isFinite(elevation) && elevation < 6) return "low_sun";

      if (config.weather_entity) {
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
      const nextNoon = attrs.next_noon;

      const fmt = (iso, fallback) => {
        try {
          if (!iso) return fallback;
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return fallback;
          return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        } catch (error) {
          return fallback;
        }
      };

      const riseDate = this._dateFromAttr(attrs.next_rising);
      const setDate = this._dateFromAttr(attrs.next_setting);
      const noonElevation = this._estimateNoonElevation(entityId, nextNoon);
      const noonY = this._clamp(88 - noonElevation * 1.15, 14, 56);

      const rise = fmt(attrs.next_rising, "06:00");
      const set = fmt(attrs.next_setting, "18:00");

      const now = new Date();
      const above = state === "above_horizon";
      const night = state === "below_horizon" || !above;

      let x = 50;
      let y = 86;

      if (!night && riseDate && setDate && setDate > riseDate) {
        const progress = this._clamp((now.getTime() - riseDate.getTime()) / (setDate.getTime() - riseDate.getTime()), 0, 1);
        x = 8 + 84 * progress;
        y = 86 - (86 - noonY) * Math.sin(progress * Math.PI);

        if (Number.isFinite(elevation)) {
          y = this._clamp(86 - elevation * 1.15, 12, 86);
        }
      } else if (night) {
        const minutes = now.getHours() * 60 + now.getMinutes();
        const t = minutes >= 18 * 60
          ? (minutes - 18 * 60) / (12 * 60)
          : (minutes + 6 * 60) / (12 * 60);

        const progress = this._clamp(t, 0, 1);
        x = 92 - 84 * progress;
        y = 90 - 18 * Math.sin(progress * Math.PI);
      }

      return {
        rise,
        set,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        noonY: Math.round(noonY * 10) / 10,
        night,
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

    _estimateNoonElevation(entityId, nextNoon) {
      const currentElevation = this._readAttributeNumber(entityId, "elevation");

      try {
        const noonDate = nextNoon ? new Date(nextNoon) : new Date();
        if (Number.isNaN(noonDate.getTime())) {
          return Number.isFinite(currentElevation) ? Math.max(currentElevation, 25) : 45;
        }

        const day = this._dayOfYear(noonDate);
        const latitude = this._hass?.config?.latitude;

        if (!Number.isFinite(latitude)) {
          return Number.isFinite(currentElevation) ? Math.max(currentElevation, 25) : 45;
        }

        const declination = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365);
        const noonElevation = 90 - Math.abs(latitude - declination);

        return this._clamp(noonElevation, 5, 75);
      } catch (error) {
        return Number.isFinite(currentElevation) ? Math.max(currentElevation, 25) : 45;
      }
    }

    _sunArcPath(noonY) {
      const y = this._clamp(this._number(noonY, 32), 14, 58);
      return `M8 86 C25 ${y} 75 ${y} 92 86`;
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

    _flowStrength(value, maxPower) {
      return this._clamp(Math.abs(value) / maxPower, 0.18, 1).toFixed(3);
    }

    _flowDuration(value, maxPower) {
      const strength = this._clamp(Math.abs(value) / maxPower, 0, 1);
      return (2.6 - strength * 1.5).toFixed(2);
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
        const decimals = abs >= 10000 ? 1 : 2;
        return `${(abs / 1000).toFixed(decimals)} kW`;
      }

      return `${Math.round(abs)} W`;
    }

    _formatSignedPower(value) {
      if (!Number.isFinite(value)) return "--";
      if (Math.abs(value) < 0.5) return "0 W";

      const sign = value > 0 ? "+" : "-";

      return `${sign}${this._formatPower(value)}`;
    }

    _formatEnergy(value) {
      if (!Number.isFinite(value)) return "-- kWh";
      return `${value.toFixed(value >= 10 ? 1 : 2)} kWh`;
    }

    _formatTemp(value) {
      if (!Number.isFinite(value)) return "-- °C";
      return `${value.toFixed(0)} °C`;
    }

    _formatNumber(value, unit, decimals) {
      if (!Number.isFinite(value)) return `-- ${unit}`;
      return `${value.toFixed(decimals)} ${unit}`;
    }

    _formatNumberOrDash(value, unit, decimals) {
      if (!Number.isFinite(value)) return `-- ${unit}`;
      return `${value.toFixed(decimals)} ${unit}`;
    }

    _batterySoc(value) {
      if (!Number.isFinite(value)) return 0;
      return this._clamp(value, 0, 100);
    }

    _socColor(value) {
      if (!Number.isFinite(value)) return "#607d8b";
      if (value <= 20) return "#ff3d00";
      if (value <= 40) return "#f4d03f";
      if (value <= 75) return "#44d66a";
      return "#00bcd4";
    }

    _number(value, fallback) {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : fallback;
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
        <svg viewBox="0 0 120 104" role="img" aria-label="Inverter">
          <defs>
            <linearGradient id="vnpInvBody" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(255,255,255,0.92)"></stop>
              <stop offset="1" stop-color="rgba(186,196,205,0.78)"></stop>
            </linearGradient>
            <linearGradient id="vnpInvScreen" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(58,90,116,0.95)"></stop>
              <stop offset="1" stop-color="rgba(18,36,52,0.95)"></stop>
            </linearGradient>
          </defs>
          <rect x="24" y="12" width="72" height="80" rx="10" fill="url(#vnpInvBody)" stroke="rgba(255,255,255,0.55)" stroke-width="2"></rect>
          <rect x="35" y="24" width="50" height="24" rx="5" fill="url(#vnpInvScreen)"></rect>
          <path d="M42 37 C49 28 55 45 62 36 C68 28 73 39 80 31" fill="none" stroke="rgba(255,213,79,0.95)" stroke-width="3" stroke-linecap="round"></path>
          <circle cx="44" cy="66" r="4" fill="rgba(50,70,84,0.85)"></circle>
          <circle cx="60" cy="66" r="4" fill="rgba(50,70,84,0.85)"></circle>
          <circle cx="76" cy="66" r="4" fill="rgba(50,70,84,0.85)"></circle>
          <line x1="45" y1="82" x2="75" y2="82" stroke="rgba(50,70,84,0.65)" stroke-width="4" stroke-linecap="round"></line>
        </svg>
      `;
    }

    _pylonSvg() {
      return `
        <svg viewBox="0 0 120 90" role="img" aria-label="Grid pylon">
          <g fill="none" stroke="rgba(220,226,234,0.90)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M32 82 L48 16 L64 82"></path>
            <path d="M40 48 H56"></path>
            <path d="M37 62 H59"></path>
            <path d="M48 16 L30 31 H66 Z"></path>
            <path d="M40 48 L59 62"></path>
            <path d="M56 48 L37 62"></path>
            <path d="M80 82 L91 34 L102 82"></path>
            <path d="M85 56 H97"></path>
            <path d="M91 34 L78 45 H104 Z"></path>
            <path d="M6 31 C24 26 42 26 60 31 C78 36 96 36 114 31"></path>
          </g>
        </svg>
      `;
    }

    _homeSvg() {
      return `
        <svg viewBox="0 0 120 82" role="img" aria-label="Home consumption">
          <g fill="none" stroke="rgba(220,226,234,0.90)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 43 L60 12 L102 43"></path>
            <path d="M30 40 V70 H90 V40"></path>
            <path d="M52 70 V52 H68 V70"></path>
            <path d="M74 29 H90 V41"></path>
          </g>
        </svg>
      `;
    }
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
