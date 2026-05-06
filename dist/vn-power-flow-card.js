/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * K-flow-like layout, original implementation
 */

(() => {
  const CARD_VERSION = "0.3.0";
  const CARD_TAG = "vn-power-flow-card";

  const DEFAULT_NAMES = {
    pv: "PV",
    home: "Home",
    grid: "Grid",
    battery: "Battery",
    inverter: "Inverter",
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
        show_inverter_details: true,
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
      return 7;
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
            <div class="vnp-topbar">
              <div class="vnp-title-wrap">
                <div class="vnp-title">⚡ ${this._escape(config.title || "VN Power Flow")}</div>
                <div class="vnp-subtitle">Real-time power flow card for Home Assistant</div>
              </div>

              <div class="vnp-status ${status === "FLOW" ? "vnp-status-flow" : ""}">
                ${status}
              </div>
            </div>

            ${missingEntities.length ? this._warning(missingEntities) : ""}

            <div class="vnp-kflow-stage vnp-sky-${this._escapeAttr(skyState)}">
              <div class="vnp-sky">
                <svg class="vnp-sky-svg" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                  <path class="vnp-sun-arc" d="M8 26 C25 2 75 2 92 26"></path>
                  <line class="vnp-horizon" x1="6" y1="27" x2="94" y2="27"></line>
                  <circle class="vnp-tick" cx="8" cy="27" r="0.8"></circle>
                  <circle class="vnp-tick" cx="50" cy="27" r="0.8"></circle>
                  <circle class="vnp-tick" cx="92" cy="27" r="0.8"></circle>
                </svg>

                <div class="vnp-time vnp-time-rise">${this._escape(sun.rise)}</div>
                <div class="vnp-time vnp-time-noon">12:00</div>
                <div class="vnp-time vnp-time-set">${this._escape(sun.set)}</div>

                <div class="vnp-sun-marker ${sun.night ? "vnp-moon" : ""}" style="--sun-x:${sun.x}; --sun-y:${sun.y};">
                  <div class="vnp-sun-rays"></div>
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
              </div>

              <div class="vnp-main">
                <svg class="vnp-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <filter id="vnpGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="0.9" result="blur"></feGaussianBlur>
                      <feMerge>
                        <feMergeNode in="blur"></feMergeNode>
                        <feMergeNode in="SourceGraphic"></feMergeNode>
                      </feMerge>
                    </filter>
                  </defs>

                  <path class="vnp-flow vnp-flow-sun ${this._flowClass(flows.sunToPv)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}"
                    d="M18 5 C20 13 23 19 27 26"></path>

                  <path class="vnp-flow vnp-flow-pv ${this._flowClass(flows.pvToInverter)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}"
                    d="M30 30 C38 38 43 43 50 49"></path>

                  <path class="vnp-flow vnp-flow-home ${this._flowClass(flows.inverterToHome)}"
                    style="--power:${this._flowStrength(homeW, maxPower)}"
                    d="M50 56 C44 64 38 70 31 76"></path>

                  <path class="vnp-flow vnp-flow-grid ${this._flowClass(flows.gridImport)} vnp-reverse"
                    style="--power:${this._flowStrength(gridImportW, maxPower)}"
                    d="M70 77 C63 70 57 64 51 56"></path>

                  <path class="vnp-flow vnp-flow-export ${this._flowClass(flows.gridExport)}"
                    style="--power:${this._flowStrength(gridExportW, maxPower)}"
                    d="M51 56 C57 64 63 70 70 77"></path>

                  <path class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryCharge)}"
                    style="--power:${this._flowStrength(batteryChargeW, maxPower)}"
                    d="M55 50 C64 44 71 39 79 34"></path>

                  <path class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryDischarge)} vnp-reverse"
                    style="--power:${this._flowStrength(batteryDischargeW, maxPower)}"
                    d="M55 50 C64 44 71 39 79 34"></path>
                </svg>

                <div class="vnp-node vnp-pv-node" style="--x:29; --y:31;">
                  <div class="vnp-node-label">${this._escape(names.pv)}</div>
                  <div class="vnp-node-main">${this._formatPower(pvW)}</div>
                  <div class="vnp-mini-row">
                    <span>PV1</span>
                    <strong>${this._formatPowerOrDash(pv1W, config.pv1_power)}</strong>
                  </div>
                  <div class="vnp-mini-row">
                    <span>PV2</span>
                    <strong>${this._formatPowerOrDash(pv2W, config.pv2_power)}</strong>
                  </div>
                </div>

                <div class="vnp-inverter" style="--x:50; --y:52;">
                  <div class="vnp-inverter-icon">☀️</div>
                  <div class="vnp-inverter-title">${this._escape(names.inverter)}</div>
                  <div class="vnp-inverter-value">${Number.isFinite(inverterTemp) ? this._formatNumber(inverterTemp, "°C", 0) : "INV"}</div>
                </div>

                <div class="vnp-node vnp-home-node" style="--x:29; --y:78;">
                  <div class="vnp-node-label">${this._escape(names.home)}</div>
                  <div class="vnp-node-main">${this._formatPower(homeW)}</div>
                  <div class="vnp-mini-row">
                    <span>Today</span>
                    <strong>${this._formatEnergy(todayLoad)}</strong>
                  </div>
                </div>

                <div class="vnp-node vnp-grid-node" style="--x:72; --y:78;">
                  <div class="vnp-node-label">${this._escape(names.grid)}</div>
                  <div class="vnp-node-main">${this._formatSignedPower(gridRawW)}</div>
                  <div class="vnp-mini-row">
                    <span>${gridImportW >= gridExportW ? "Import" : "Export"}</span>
                    <strong>${gridImportW >= gridExportW ? this._formatPower(gridImportW) : this._formatPower(gridExportW)}</strong>
                  </div>
                </div>

                <div class="vnp-battery" style="--x:81; --y:37;">
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

                <div class="vnp-endurance" style="--x:50; --y:88;">
                  <span>ENDURANCE</span>
                  <strong>${this._enduranceText(batterySoc, homeW, batteryVoltage, batteryCurrent)}</strong>
                </div>
              </div>
            </div>

            ${
              this._bool(config.show_details, true)
                ? `
                  <div class="vnp-details">
                    ${this._detailBox("Today PV", this._formatEnergy(todayPv), "☀️")}
                    ${this._detailBox("Batt Chg", this._formatEnergy(todayBattCharge), "↯")}
                    ${this._detailBox("Batt Dis.", this._formatEnergy(todayBattDischarge), "↯")}
                    ${this._detailBox("Grid Import", this._formatEnergy(gridImportEnergy), "⚡")}
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
            radial-gradient(circle at 18% 0%, rgba(255, 213, 79, 0.18), transparent 32%),
            radial-gradient(circle at 100% 30%, rgba(79, 195, 247, 0.14), transparent 30%),
            var(--vnp-card-bg);
          color: var(--vnp-text);
        }

        .vnp-card {
          padding: 14px;
          box-sizing: border-box;
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
          font-size: 18px;
          line-height: 1.15;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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
          box-shadow: 0 0 22px rgba(255, 213, 79, 0.22);
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

        .vnp-kflow-stage {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--vnp-border);
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(31, 42, 56, 0.92), rgba(10, 15, 22, 0.55)),
            rgba(255, 255, 255, 0.03);
        }

        .vnp-kflow-stage.vnp-sky-clear {
          background:
            radial-gradient(circle at 19% 8%, rgba(255, 213, 79, 0.25), transparent 28%),
            linear-gradient(180deg, rgba(30, 51, 72, 0.92), rgba(10, 15, 22, 0.52));
        }

        .vnp-kflow-stage.vnp-sky-night {
          background:
            radial-gradient(circle at 22% 10%, rgba(144, 202, 249, 0.16), transparent 28%),
            linear-gradient(180deg, rgba(9, 17, 32, 0.96), rgba(4, 7, 14, 0.68));
        }

        .vnp-sky {
          position: relative;
          height: 122px;
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
          stroke-width: 0.9;
          stroke-dasharray: 2.5 2.5;
          vector-effect: non-scaling-stroke;
        }

        .vnp-horizon {
          stroke: rgba(255, 255, 255, 0.16);
          stroke-width: 0.8;
          vector-effect: non-scaling-stroke;
        }

        .vnp-tick {
          fill: rgba(255, 255, 255, 0.45);
        }

        .vnp-time {
          position: absolute;
          bottom: 18px;
          transform: translateX(-50%);
          color: var(--vnp-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .vnp-time-rise {
          left: 8%;
        }

        .vnp-time-noon {
          left: 50%;
        }

        .vnp-time-set {
          left: 92%;
        }

        .vnp-sun-marker {
          position: absolute;
          left: calc(var(--sun-x) * 1%);
          top: calc(var(--sun-y) * 1%);
          width: 58px;
          height: 58px;
          transform: translate(-50%, -50%);
          z-index: 6;
        }

        .vnp-sun-rays {
          position: absolute;
          inset: 4px;
          border-radius: 999px;
          background: conic-gradient(
            rgba(255, 213, 79, 0.95),
            transparent 16deg,
            rgba(255, 193, 7, 0.80) 32deg,
            transparent 52deg,
            rgba(255, 213, 79, 0.95) 84deg,
            transparent 106deg,
            rgba(255, 193, 7, 0.80) 135deg,
            transparent 168deg,
            rgba(255, 213, 79, 0.90) 210deg,
            transparent 245deg,
            rgba(255, 193, 7, 0.85) 292deg,
            transparent 330deg
          );
          animation: vnpSpin 17s linear infinite;
          opacity: 0.95;
        }

        .vnp-sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 39px;
          height: 39px;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255, 213, 79, 0.22);
          box-shadow: 0 0 28px rgba(255, 213, 79, 0.58);
          font-size: 28px;
        }

        .vnp-moon .vnp-sun-rays {
          opacity: 0.12;
          animation-duration: 34s;
          filter: grayscale(1);
        }

        .vnp-moon .vnp-sun-core {
          background: rgba(144, 202, 249, 0.12);
          box-shadow: 0 0 22px rgba(144, 202, 249, 0.35);
        }

        @keyframes vnpSpin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        .vnp-cloud-layer {
          position: absolute;
          z-index: 8;
          left: 7%;
          top: 15%;
          width: 38%;
          height: 60%;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.35s ease;
        }

        .vnp-cloud-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-cloud {
          position: absolute;
          width: 40%;
          height: 28%;
          border-radius: 999px;
          background: rgba(236, 239, 241, 0.85);
          box-shadow: 0 0 18px rgba(255, 255, 255, 0.22);
          animation: vnpCloud 7s ease-in-out infinite alternate;
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

        .vnp-cloud-a {
          left: 10%;
          top: 30%;
        }

        .vnp-cloud-b {
          left: 45%;
          top: 45%;
          transform: scale(0.78);
          animation-duration: 9s;
        }

        .vnp-cloud-c {
          left: 64%;
          top: 14%;
          transform: scale(0.68);
          opacity: 0.78;
          animation-duration: 11s;
        }

        @keyframes vnpCloud {
          from {
            margin-left: -3%;
          }

          to {
            margin-left: 5%;
          }
        }

        .vnp-snow-layer {
          position: absolute;
          z-index: 9;
          left: 17%;
          top: 20%;
          width: 24%;
          height: 80%;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.35s ease;
        }

        .vnp-snow-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-snow-layer span {
          position: absolute;
          top: 0;
          color: rgba(225, 245, 254, 0.95);
          animation: vnpSnow 3.3s linear infinite;
        }

        .vnp-snow-layer span:nth-child(1) {
          left: 8%;
          animation-delay: 0s;
        }

        .vnp-snow-layer span:nth-child(2) {
          left: 34%;
          animation-delay: 0.7s;
        }

        .vnp-snow-layer span:nth-child(3) {
          left: 62%;
          animation-delay: 1.4s;
        }

        .vnp-snow-layer span:nth-child(4) {
          left: 88%;
          animation-delay: 2.1s;
        }

        @keyframes vnpSnow {
          from {
            transform: translateY(0) rotate(0deg);
            opacity: 0;
          }

          20% {
            opacity: 1;
          }

          to {
            transform: translateY(72px) rotate(180deg);
            opacity: 0;
          }
        }

        .vnp-main {
          position: relative;
          min-height: 385px;
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
          stroke-width: calc(0.7px + (var(--power, 0.2) * 2.5px));
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 2.5 3.2;
          opacity: 0.25;
          vector-effect: non-scaling-stroke;
        }

        .vnp-flow.vnp-active {
          opacity: 0.96;
          filter: url(#vnpGlow);
          animation: vnpFlow 1.1s linear infinite;
        }

        .vnp-flow.vnp-reverse {
          animation-direction: reverse;
        }

        .vnp-flow.vnp-inactive {
          stroke-dasharray: none;
        }

        .vnp-flow-sun {
          stroke: var(--vnp-sun);
        }

        .vnp-flow-pv {
          stroke: var(--vnp-pv);
        }

        .vnp-flow-home {
          stroke: var(--vnp-home);
        }

        .vnp-flow-grid {
          stroke: var(--vnp-grid);
        }

        .vnp-flow-export {
          stroke: var(--vnp-export);
        }

        .vnp-flow-battery {
          stroke: var(--vnp-battery);
        }

        @keyframes vnpFlow {
          from {
            stroke-dashoffset: 0;
          }

          to {
            stroke-dashoffset: -11.4;
          }
        }

        .vnp-node,
        .vnp-inverter,
        .vnp-battery,
        .vnp-endurance {
          position: absolute;
          z-index: 3;
          left: calc(var(--x) * 1%);
          top: calc(var(--y) * 1%);
          transform: translate(-50%, -50%);
          box-sizing: border-box;
        }

        .vnp-node {
          width: clamp(104px, 25%, 142px);
          min-height: 92px;
          border: 1px solid var(--vnp-border);
          border-radius: 16px;
          background: var(--vnp-panel);
          backdrop-filter: blur(8px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          padding: 10px;
          text-align: center;
        }

        .vnp-node-label {
          color: var(--vnp-muted);
          font-size: 12px;
          line-height: 1.2;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .vnp-node-main {
          margin: 5px 0 8px;
          font-size: 18px;
          line-height: 1.05;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .vnp-mini-row {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          color: var(--vnp-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .vnp-mini-row strong {
          color: var(--vnp-text);
          font-weight: 800;
        }

        .vnp-inverter {
          width: clamp(112px, 26%, 148px);
          min-height: 92px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255, 213, 79, 0.34);
          border-radius: 18px;
          background:
            radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.18), transparent 54%),
            var(--vnp-panel-strong);
          box-shadow: 0 0 26px rgba(255, 213, 79, 0.12);
          text-align: center;
          padding: 10px;
        }

        .vnp-inverter-icon {
          font-size: 28px;
          line-height: 1;
        }

        .vnp-inverter-title {
          color: var(--vnp-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .vnp-inverter-value {
          font-size: 15px;
          font-weight: 900;
        }

        .vnp-battery {
          width: clamp(104px, 24%, 136px);
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
          height: 164px;
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
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent),
            var(--batt-color);
          box-shadow: 0 0 18px color-mix(in srgb, var(--batt-color), transparent 45%);
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
          font-size: 11px;
          color: rgba(255, 255, 255, 0.86);
        }

        .vnp-endurance {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 164px;
          border: 1px solid var(--vnp-border);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.07);
          padding: 8px 12px;
          font-size: 12px;
        }

        .vnp-endurance span {
          color: var(--vnp-muted);
          font-weight: 800;
        }

        .vnp-endurance strong {
          font-weight: 900;
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
          color: var(--vnp-muted);
          font-size: 11px;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .vnp-detail-value {
          display: block;
          margin-top: 3px;
          font-size: 13px;
          line-height: 1.15;
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @media (max-width: 620px) {
          .vnp-card {
            padding: 12px;
          }

          .vnp-subtitle {
            display: none;
          }

          .vnp-sky {
            height: 108px;
          }

          .vnp-main {
            min-height: 420px;
          }

          .vnp-node {
            width: 105px;
            min-height: 86px;
            padding: 8px;
          }

          .vnp-node-main {
            font-size: 15px;
          }

          .vnp-inverter {
            width: 110px;
            min-height: 84px;
          }

          .vnp-battery {
            width: 104px;
          }

          .vnp-battery-shell {
            height: 142px;
          }

          .vnp-details {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 390px) {
          .vnp-title {
            font-size: 16px;
          }

          .vnp-status {
            padding: 6px 9px;
            font-size: 11px;
          }

          .vnp-main {
            min-height: 430px;
          }

          .vnp-node {
            width: 96px;
          }

          .vnp-battery {
            width: 96px;
          }

          .vnp-endurance {
            min-width: 138px;
            font-size: 11px;
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

      const rise = fmt(attrs.next_rising, "06:00");
      const set = fmt(attrs.next_setting, "18:00");

      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();

      const fallbackRise = 6 * 60;
      const fallbackSet = 18 * 60;
      const daylight = fallbackSet - fallbackRise;

      let progress = (minutes - fallbackRise) / daylight;
      progress = this._clamp(progress, 0, 1);

      const above = state === "above_horizon";
      const night = state === "below_horizon" || !above;

      let x;
      let y;

      if (night) {
        const nightProgress = minutes > fallbackSet
          ? (minutes - fallbackSet) / (1440 - daylight)
          : (minutes + 1440 - fallbackSet) / (1440 - daylight);

        const t = this._clamp(nightProgress, 0, 1);
        x = 92 - 84 * t;
        y = 30 - 13 * Math.sin(t * Math.PI);
      } else {
        x = 8 + 84 * progress;
        y = 27 - 23 * Math.sin(progress * Math.PI);

        if (Number.isFinite(elevation)) {
          y = this._clamp(28 - elevation * 0.62, 5, 28);
        }
      }

      return {
        rise,
        set,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        night,
      };
    }

    _flowClass(active) {
      return active ? "vnp-active" : "vnp-inactive";
    }

    _flowStrength(value, maxPower) {
      return this._clamp(Math.abs(value) / maxPower, 0.14, 1).toFixed(3);
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

    _formatPowerOrDash(value, configuredEntity) {
      if (!configuredEntity) return "-- W";
      return this._formatPower(value);
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
      if (value <= 75) return "#44ff00";
      return "#00d4ff";
    }

    _enduranceText(soc, homeW, voltage, current) {
      if (!Number.isFinite(soc)) return "-- remaining";

      if (Number.isFinite(voltage) && Number.isFinite(current) && homeW > 50) {
        const batteryPowerApprox = Math.abs(voltage * current);
        if (batteryPowerApprox > 50) {
          const hours = batteryPowerApprox / homeW;
          return `${this._formatDuration(hours)} remaining`;
        }
      }

      return `${Math.round(soc)}% remaining`;
    }

    _formatDuration(hours) {
      if (!Number.isFinite(hours) || hours <= 0) return "--";
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      return `${h}h ${String(m).padStart(2, "0")}m`;
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