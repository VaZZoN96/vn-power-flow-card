/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * Repository: vn-power-flow-card
 */

(() => {
  const CARD_VERSION = "0.2.0";
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
        show_sun: true,
        show_clouds: true,
        show_snow: true,
        show_stats: true,
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
      return 5;
    }

    _render() {
      if (!this.shadowRoot || !this._config) return;

      const config = this._config;
      const hass = this._hass;
      const names = { ...DEFAULT_NAMES, ...(config.names || {}) };
      const threshold = this._number(config.threshold_w, 30);
      const maxPower = Math.max(this._number(config.max_power_w, 10000), 1000);

      const pvW = Math.max(0, this._readPower(config.pv_power));
      const homeW = Math.max(0, this._readPower(config.home_power));
      const gridRawW = this._readPower(config.grid_power);
      const batteryRawW = this._readPower(config.battery_power);
      const batterySoc = this._readNumber(config.battery_soc);

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
      const isNight = skyState === "night";
      const isLowSun = skyState === "low_sun";

      const showClouds =
        this._bool(config.show_clouds, true) &&
        CLOUDY_STATES.has(skyState);

      const showSnow =
        this._bool(config.show_snow, true) &&
        SNOW_STATES.has(skyState);

      const showSun = this._bool(config.show_sun, true);
      const showStats = this._bool(config.show_stats, true);

      const flows = {
        sunToPv: showSun && pvW > threshold && !isNight,
        pvToHome: pvW > threshold,
        pvToBattery: batteryChargeW > threshold,
        batteryToHome: batteryDischargeW > threshold,
        gridToHome: gridImportW > threshold,
        homeToGrid: gridExportW > threshold,
        pvToGrid: gridExportW > threshold && pvW > threshold,
      };

      const missingEntities = this._missingEntities(config, hass);

      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>

        <ha-card>
          <div class="vnp-card">
            <div class="vnp-header">
              <div class="vnp-heading">
                <div class="vnp-title">${this._escape(config.title || "VN Power Flow")}</div>
                <div class="vnp-subtitle">Real-time power flow card for Home Assistant</div>
              </div>

              <div class="vnp-sky-pill vnp-sky-${this._escapeAttr(skyState)}">
                ${this._labelForSkyState(skyState)}
              </div>
            </div>

            ${missingEntities.length ? this._warning(missingEntities) : ""}

            <div class="vnp-stage vnp-sky-${this._escapeAttr(skyState)}">
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

                <path
                  class="vnp-flow vnp-flow-sun ${this._flowClass(flows.sunToPv)}"
                  style="--power: ${this._flowStrength(pvW, maxPower)}"
                  d="M15 19 C20 25 27 32 34 40"
                ></path>

                <path
                  class="vnp-flow vnp-flow-pv ${this._flowClass(flows.pvToHome)}"
                  style="--power: ${this._flowStrength(pvW, maxPower)}"
                  d="M34 42 C38 51 44 57 50 63"
                ></path>

                <path
                  class="vnp-flow vnp-flow-pv ${this._flowClass(flows.pvToBattery)}"
                  style="--power: ${this._flowStrength(batteryChargeW, maxPower)}"
                  d="M36 39 C49 29 65 27 78 35"
                ></path>

                <path
                  class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryToHome)}"
                  style="--power: ${this._flowStrength(batteryDischargeW, maxPower)}"
                  d="M77 39 C68 47 60 56 51 64"
                ></path>

                <path
                  class="vnp-flow vnp-flow-grid ${this._flowClass(flows.gridToHome)}"
                  style="--power: ${this._flowStrength(gridImportW, maxPower)}"
                  d="M80 76 C68 74 58 70 51 64"
                ></path>

                <path
                  class="vnp-flow vnp-flow-export ${this._flowClass(flows.homeToGrid)}"
                  style="--power: ${this._flowStrength(gridExportW, maxPower)}"
                  d="M51 66 C62 70 72 73 81 76"
                ></path>

                <path
                  class="vnp-flow vnp-flow-export ${this._flowClass(flows.pvToGrid)}"
                  style="--power: ${this._flowStrength(gridExportW, maxPower)}"
                  d="M35 43 C49 55 63 67 80 75"
                ></path>
              </svg>

              ${
                showSun
                  ? `
                    <div class="vnp-node vnp-sun-node ${isNight ? "vnp-night" : ""} ${isLowSun ? "vnp-low-sun" : ""}" style="--x: 15; --y: 19;">
                      <div class="vnp-sun-wrap">
                        <div class="vnp-sun-rays"></div>
                        <div class="vnp-sun-core">☀</div>
                      </div>
                      <div class="vnp-node-title">${this._escape(names.sun)}</div>
                      <div class="vnp-node-value">${this._sunValue(config.sun_entity)}</div>
                    </div>
                  `
                  : ""
              }

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

              <div class="vnp-node vnp-pv-node" style="--x: 34; --y: 42;">
                <div class="vnp-icon">☀️</div>
                <div class="vnp-node-title">${this._escape(names.pv)}</div>
                <div class="vnp-node-value">${this._formatPower(pvW)}</div>
              </div>

              <div class="vnp-node vnp-home-node vnp-primary" style="--x: 50; --y: 66;">
                <div class="vnp-icon">⌂</div>
                <div class="vnp-node-title">${this._escape(names.home)}</div>
                <div class="vnp-node-value">${this._formatPower(homeW)}</div>
              </div>

              <div class="vnp-node vnp-battery-node" style="--x: 78; --y: 38;">
                <div class="vnp-icon">▰</div>
                <div class="vnp-node-title">${this._escape(names.battery)}</div>
                <div class="vnp-node-value">${this._formatSignedPower(batteryRawW)}</div>
                ${Number.isFinite(batterySoc) ? this._batteryBar(batterySoc) : ""}
              </div>

              <div class="vnp-node vnp-grid-node" style="--x: 82; --y: 78;">
                <div class="vnp-icon">⚡</div>
                <div class="vnp-node-title">${this._escape(names.grid)}</div>
                <div class="vnp-node-value">${this._formatSignedPower(gridRawW)}</div>
              </div>
            </div>

            ${
              showStats
                ? `
                  <div class="vnp-stats">
                    <div class="vnp-stat">
                      <span>PV</span>
                      <strong>${this._formatPower(pvW)}</strong>
                    </div>

                    <div class="vnp-stat">
                      <span>Home</span>
                      <strong>${this._formatPower(homeW)}</strong>
                    </div>

                    <div class="vnp-stat">
                      <span>Grid</span>
                      <strong>
                        ${
                          gridImportW > gridExportW
                            ? `Import ${this._formatPower(gridImportW)}`
                            : gridExportW > threshold
                              ? `Export ${this._formatPower(gridExportW)}`
                              : this._formatPower(0)
                        }
                      </strong>
                    </div>

                    <div class="vnp-stat">
                      <span>Battery</span>
                      <strong>
                        ${
                          batteryChargeW > batteryDischargeW
                            ? `Charge ${this._formatPower(batteryChargeW)}`
                            : batteryDischargeW > threshold
                              ? `Discharge ${this._formatPower(batteryDischargeW)}`
                              : this._formatPower(0)
                        }
                      </strong>
                    </div>
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
          --vnp-card-radius: var(--ha-card-border-radius, 16px);
          --vnp-card-bg: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          --vnp-primary-text: var(--primary-text-color, #f5f5f5);
          --vnp-secondary-text: var(--secondary-text-color, #a7a7a7);
          --vnp-border: rgba(255, 255, 255, 0.12);
          --vnp-node-bg: rgba(255, 255, 255, 0.08);
          --vnp-node-bg-strong: rgba(255, 255, 255, 0.14);
          --vnp-pv: #ffb300;
          --vnp-sun: #ffd54f;
          --vnp-grid: #ab47bc;
          --vnp-battery: #66bb6a;
          --vnp-export: #26c6da;
          --vnp-muted: rgba(255, 255, 255, 0.20);
        }

        ha-card {
          overflow: hidden;
          border-radius: var(--vnp-card-radius);
          background:
            radial-gradient(circle at 16% 0%, rgba(255, 179, 0, 0.16), transparent 34%),
            radial-gradient(circle at 90% 20%, rgba(66, 165, 245, 0.12), transparent 30%),
            var(--vnp-card-bg);
          color: var(--vnp-primary-text);
        }

        .vnp-card {
          padding: 16px;
          box-sizing: border-box;
        }

        .vnp-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .vnp-heading {
          min-width: 0;
        }

        .vnp-title {
          font-size: 18px;
          line-height: 1.15;
          font-weight: 700;
        }

        .vnp-subtitle {
          margin-top: 3px;
          color: var(--vnp-secondary-text);
          font-size: 12px;
          line-height: 1.25;
        }

        .vnp-sky-pill {
          flex: 0 0 auto;
          border: 1px solid var(--vnp-border);
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          color: var(--vnp-secondary-text);
          font-size: 12px;
          line-height: 1;
          padding: 7px 10px;
          white-space: nowrap;
          text-transform: capitalize;
        }

        .vnp-sky-clear {
          color: #ffd54f;
        }

        .vnp-sky-partly_cloudy,
        .vnp-sky-partlycloudy,
        .vnp-sky-cloudy,
        .vnp-sky-overcast {
          color: #cfd8dc;
        }

        .vnp-sky-snow,
        .vnp-sky-snowy,
        .vnp-sky-snow_or_blocked,
        .vnp-sky-blocked {
          color: #e1f5fe;
        }

        .vnp-sky-night {
          color: #90caf9;
        }

        .vnp-warning {
          border: 1px solid rgba(255, 193, 7, 0.35);
          background: rgba(255, 193, 7, 0.10);
          border-radius: 12px;
          font-size: 12px;
          line-height: 1.35;
          margin: 0 0 12px;
          padding: 9px 10px;
        }

        .vnp-stage {
          position: relative;
          width: 100%;
          aspect-ratio: 1.55 / 1;
          min-height: 300px;
          max-height: 460px;
          overflow: hidden;
          border: 1px solid var(--vnp-border);
          border-radius: 18px;
          background:
            radial-gradient(circle at 15% 19%, rgba(255, 213, 79, 0.16), transparent 18%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.025));
        }

        .vnp-stage.vnp-sky-night {
          background:
            radial-gradient(circle at 15% 19%, rgba(144, 202, 249, 0.13), transparent 18%),
            linear-gradient(180deg, rgba(13, 27, 42, 0.72), rgba(0, 0, 0, 0.14));
        }

        .vnp-stage.vnp-sky-clear {
          background:
            radial-gradient(circle at 15% 19%, rgba(255, 213, 79, 0.23), transparent 20%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.025));
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
          stroke: var(--vnp-muted);
          stroke-width: calc(0.6px + (var(--power, 0.2) * 1.8px));
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 2.2 2.6;
          opacity: 0.24;
          vector-effect: non-scaling-stroke;
          transition: opacity 0.35s ease, stroke-width 0.35s ease;
        }

        .vnp-flow.vnp-active {
          opacity: 0.96;
          filter: url(#vnpGlow);
          animation: vnpFlow 1.05s linear infinite;
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

        .vnp-flow-battery {
          stroke: var(--vnp-battery);
        }

        .vnp-flow-grid {
          stroke: var(--vnp-grid);
        }

        .vnp-flow-export {
          stroke: var(--vnp-export);
        }

        @keyframes vnpFlow {
          from {
            stroke-dashoffset: 0;
          }

          to {
            stroke-dashoffset: -9.6;
          }
        }

        .vnp-node {
          position: absolute;
          z-index: 3;
          left: calc(var(--x) * 1%);
          top: calc(var(--y) * 1%);
          transform: translate(-50%, -50%);
          width: clamp(88px, 23%, 128px);
          min-height: 74px;
          box-sizing: border-box;
          border: 1px solid var(--vnp-border);
          border-radius: 16px;
          background: var(--vnp-node-bg);
          backdrop-filter: blur(9px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          padding: 10px;
          text-align: center;
        }

        .vnp-node.vnp-primary {
          background: var(--vnp-node-bg-strong);
        }

        .vnp-sun-node {
          width: clamp(86px, 20%, 118px);
          min-height: 92px;
          border: 0;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
          padding: 0;
        }

        .vnp-icon {
          font-size: 22px;
          line-height: 1;
          margin-bottom: 5px;
        }

        .vnp-node-title {
          overflow: hidden;
          color: var(--vnp-secondary-text);
          font-size: 12px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-node-value {
          margin-top: 4px;
          overflow: hidden;
          font-size: 16px;
          font-weight: 700;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vnp-sun-wrap {
          position: relative;
          width: 64px;
          height: 64px;
          margin: 0 auto 4px;
        }

        .vnp-sun-rays {
          position: absolute;
          inset: 3px;
          border-radius: 999px;
          background: conic-gradient(
            from 0deg,
            rgba(255, 193, 7, 0.95),
            transparent 18deg,
            rgba(255, 193, 7, 0.75) 32deg,
            transparent 50deg,
            rgba(255, 193, 7, 0.85) 70deg,
            transparent 92deg,
            rgba(255, 193, 7, 0.8) 118deg,
            transparent 140deg,
            rgba(255, 193, 7, 0.75) 160deg,
            transparent 190deg,
            rgba(255, 193, 7, 0.8) 216deg,
            transparent 245deg,
            rgba(255, 193, 7, 0.9) 280deg,
            transparent 320deg
          );
          animation: vnpSpinSun 16s linear infinite;
          filter: blur(0.15px);
        }

        .vnp-sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 43px;
          height: 43px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255, 193, 7, 0.20);
          box-shadow: 0 0 26px rgba(255, 193, 7, 0.55);
          font-size: 30px;
        }

        .vnp-sun-node.vnp-night .vnp-sun-rays,
        .vnp-sun-node.vnp-low-sun .vnp-sun-rays {
          opacity: 0.22;
          animation-duration: 35s;
        }

        .vnp-sun-node.vnp-night .vnp-sun-core {
          filter: grayscale(1);
          opacity: 0.55;
          box-shadow: 0 0 18px rgba(144, 202, 249, 0.25);
        }

        @keyframes vnpSpinSun {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        .vnp-battery-bar {
          height: 7px;
          margin-top: 7px;
          overflow: hidden;
          border: 1px solid var(--vnp-border);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }

        .vnp-battery-fill {
          height: 100%;
          width: var(--soc, 0%);
          border-radius: 999px;
          background: var(--vnp-battery);
        }

        .vnp-cloud-layer {
          position: absolute;
          z-index: 4;
          left: 8%;
          top: 10%;
          width: 34%;
          height: 26%;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.45s ease;
        }

        .vnp-cloud-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-cloud {
          position: absolute;
          width: 42%;
          height: 27%;
          border-radius: 999px;
          background: rgba(236, 239, 241, 0.83);
          box-shadow: 0 0 18px rgba(255, 255, 255, 0.20);
          animation: vnpCloudDrift 7s ease-in-out infinite alternate;
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
          left: 46%;
          width: 52%;
          height: 135%;
        }

        .vnp-cloud-a {
          left: 10%;
          top: 25%;
          transform: scale(1.05);
        }

        .vnp-cloud-b {
          left: 44%;
          top: 45%;
          transform: scale(0.82);
          animation-duration: 9s;
        }

        .vnp-cloud-c {
          left: 62%;
          top: 12%;
          transform: scale(0.70);
          opacity: 0.80;
          animation-duration: 10s;
        }

        @keyframes vnpCloudDrift {
          from {
            margin-left: -3%;
          }

          to {
            margin-left: 5%;
          }
        }

        .vnp-snow-layer {
          position: absolute;
          z-index: 5;
          left: 16%;
          top: 24%;
          width: 24%;
          height: 36%;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.45s ease;
        }

        .vnp-snow-layer.vnp-visible {
          opacity: 1;
        }

        .vnp-snow-layer span {
          position: absolute;
          top: 0;
          color: rgba(225, 245, 254, 0.95);
          animation: vnpSnowFall 3.4s linear infinite;
        }

        .vnp-snow-layer span:nth-child(1) {
          left: 10%;
          animation-delay: 0s;
        }

        .vnp-snow-layer span:nth-child(2) {
          left: 35%;
          animation-delay: 0.7s;
        }

        .vnp-snow-layer span:nth-child(3) {
          left: 62%;
          animation-delay: 1.4s;
        }

        .vnp-snow-layer span:nth-child(4) {
          left: 86%;
          animation-delay: 2.1s;
        }

        @keyframes vnpSnowFall {
          from {
            transform: translateY(0) rotate(0deg);
            opacity: 0;
          }

          20% {
            opacity: 1;
          }

          to {
            transform: translateY(96px) rotate(180deg);
            opacity: 0;
          }
        }

        .vnp-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }

        .vnp-stat {
          min-width: 0;
          border: 1px solid var(--vnp-border);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.055);
          padding: 8px;
        }

        .vnp-stat span {
          display: block;
          margin-bottom: 2px;
          color: var(--vnp-secondary-text);
          font-size: 11px;
          line-height: 1.15;
        }

        .vnp-stat strong {
          display: block;
          overflow: hidden;
          font-size: 12px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 520px) {
          .vnp-card {
            padding: 12px;
          }

          .vnp-header {
            align-items: stretch;
          }

          .vnp-subtitle {
            display: none;
          }

          .vnp-stage {
            aspect-ratio: 1 / 1;
            min-height: 280px;
          }

          .vnp-node {
            width: 92px;
            min-height: 68px;
            padding: 8px;
            border-radius: 14px;
          }

          .vnp-node-value {
            font-size: 14px;
          }

          .vnp-sun-node {
            width: 86px;
            min-height: 84px;
          }

          .vnp-sun-wrap {
            width: 56px;
            height: 56px;
          }

          .vnp-sun-core {
            width: 38px;
            height: 38px;
            font-size: 26px;
          }

          .vnp-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 370px) {
          .vnp-node {
            width: 82px;
            min-height: 64px;
            padding: 7px;
          }

          .vnp-node-title {
            font-size: 11px;
          }

          .vnp-node-value {
            font-size: 13px;
          }
        }
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
        "home_power",
        "grid_power",
        "battery_power",
        "battery_soc",
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

    _labelForSkyState(value) {
      const labels = {
        clear: "Clear",
        partly_cloudy: "Partly cloudy",
        partlycloudy: "Partly cloudy",
        cloudy: "Cloudy",
        overcast: "Overcast",
        rainy: "Rain",
        snow: "Snow",
        snowy: "Snow",
        snow_or_blocked: "Snow / blocked",
        blocked: "Blocked",
        low_sun: "Low sun",
        night: "Night",
        unknown: "Unknown",
      };

      return labels[value] || String(value || "unknown").replace(/_/g, " ");
    }

    _sunValue(entity) {
      const entityId = entity || "sun.sun";
      const state = this._readState(entityId);
      const elevation = this._readAttributeNumber(entityId, "elevation");

      if (Number.isFinite(elevation)) {
        return `${Math.round(elevation)}°`;
      }

      if (!state || ["unknown", "unavailable"].includes(state)) return "-";

      return state === "above_horizon" ? "Up" : "Down";
    }

    _batteryBar(value) {
      const soc = this._clamp(value, 0, 100);

      return `
        <div class="vnp-battery-bar" title="${Math.round(soc)}%">
          <div class="vnp-battery-fill" style="--soc: ${soc}%"></div>
        </div>
      `;
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

      if (!Number.isFinite(abs)) return "-";

      if (abs >= 1000) {
        const decimals = abs >= 10000 ? 1 : 2;
        return `${(abs / 1000).toFixed(decimals)} kW`;
      }

      return `${Math.round(abs)} W`;
    }

    _formatSignedPower(value) {
      if (!Number.isFinite(value)) return "-";
      if (Math.abs(value) < 0.5) return "0 W";

      const sign = value > 0 ? "+" : "-";

      return `${sign}${this._formatPower(value)}`;
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
        .replace(/\"/g, "&quot;")
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