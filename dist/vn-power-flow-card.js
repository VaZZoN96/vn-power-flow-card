/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * Repository: vn-power-flow-card
 */

(() => {
  const CARD_VERSION = "0.1.0";
  const CARD_TAG = "vn-power-flow-card";

  const DEFAULT_NAMES = {
    pv: "PV",
    home: "Home",
    grid: "Grid",
    battery: "Battery",
    sun: "Sun",
  };

  const SKY_STATES_WITH_CLOUDS = new Set([
    "partly_cloudy",
    "partlycloudy",
    "cloudy",
    "overcast",
    "rainy",
    "pouring",
    "snowy",
    "snow",
    "snow_or_blocked",
    "blocked",
  ]);

  const SKY_STATES_WITH_SNOW = new Set(["snow", "snowy", "snow_or_blocked", "blocked"]);

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

      const hass = this._hass;
      const config = this._config;
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
      const showClouds =
        this._bool(config.show_clouds, true) &&
        SKY_STATES_WITH_CLOUDS.has(skyState);

      const showSnow =
        this._bool(config.show_snow, true) &&
        SKY_STATES_WITH_SNOW.has(skyState);

      const isNight = skyState === "night";
      const isLowSun = skyState === "low_sun";

      const flows = {
        sunToPv: pvW > threshold && !isNight,
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
          <div class="card">
            <div class="header">
              <div>
                <div class="title">${this._escape(config.title || "VN Power Flow")}</div>
                <div class="subtitle">Real-time power flow card for Home Assistant</div>
              </div>
              <div class="sky-pill sky-${this._escapeAttr(skyState)}">
                ${this._labelForSkyState(skyState)}
              </div>
            </div>

            ${missingEntities.length ? this._warning(missingEntities) : ""}

            <div class="stage sky-${this._escapeAttr(skyState)}">
              <svg class="flow-svg" viewBox="0 0 800 520" aria-hidden="true">
                <defs>
                  <filter id="vnGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <path class="flow decorative ${this._flowClass(flows.sunToPv)}"
                  style="--power: ${this._flowStrength(pvW, maxPower)}"
                  d="M160 110 C220 105 250 130 282 162" />

                <path class="flow pv ${this._flowClass(flows.pvToHome)}"
                  style="--power: ${this._flowStrength(pvW, maxPower)}"
                  d="M278 220 C305 280 345 317 386 342" />

                <path class="flow pv ${this._flowClass(flows.pvToBattery)}"
                  style="--power: ${this._flowStrength(batteryChargeW, maxPower)}"
                  d="M322 188 C405 132 495 132 568 185" />

                <path class="flow battery ${this._flowClass(flows.batteryToHome)} reverse"
                  style="--power: ${this._flowStrength(batteryDischargeW, maxPower)}"
                  d="M573 222 C536 282 485 322 425 346" />

                <path class="flow grid ${this._flowClass(flows.gridToHome)} reverse"
                  style="--power: ${this._flowStrength(gridImportW, maxPower)}"
                  d="M588 376 C530 414 470 405 424 370" />

                <path class="flow grid ${this._flowClass(flows.homeToGrid)}"
                  style="--power: ${this._flowStrength(gridExportW, maxPower)}"
                  d="M424 370 C470 405 530 414 588 376" />

                <path class="flow export ${this._flowClass(flows.pvToGrid)}"
                  style="--power: ${this._flowStrength(gridExportW, maxPower)}"
                  d="M306 218 C378 295 485 340 590 352" />
              </svg>

              <div class="node sun-node ${isNight ? "night" : ""} ${isLowSun ? "low" : ""}">
                <div class="sun-wrap">
                  <div class="sun-rays"></div>
                  <div class="sun-core">☀</div>
                </div>
                <div class="node-title">${this._escape(names.sun)}</div>
                <div class="node-value">${this._sunValue(config.sun_entity)}</div>
              </div>

              <div class="cloud-layer ${showClouds ? "visible" : ""}">
                <div class="cloud cloud-a"></div>
                <div class="cloud cloud-b"></div>
                <div class="cloud cloud-c"></div>
              </div>

              <div class="snow-layer ${showSnow ? "visible" : ""}">
                <span>❄</span>
                <span>❄</span>
                <span>❄</span>
                <span>❄</span>
              </div>

              <div class="node pv-node">
                <div class="icon">☀️</div>
                <div class="node-title">${this._escape(names.pv)}</div>
                <div class="node-value">${this._formatPower(pvW)}</div>
              </div>

              <div class="node home-node primary">
                <div class="icon">⌂</div>
                <div class="node-title">${this._escape(names.home)}</div>
                <div class="node-value">${this._formatPower(homeW)}</div>
              </div>

              <div class="node battery-node">
                <div class="icon">▰</div>
                <div class="node-title">${this._escape(names.battery)}</div>
                <div class="node-value">${this._formatSignedPower(batteryRawW)}</div>
                ${Number.isFinite(batterySoc) ? this._batteryBar(batterySoc) : ""}
              </div>

              <div class="node grid-node">
                <div class="icon">⚡</div>
                <div class="node-title">${this._escape(names.grid)}</div>
                <div class="node-value">${this._formatSignedPower(gridRawW)}</div>
              </div>
            </div>

            <div class="stats">
              <div class="stat">
                <span>PV</span>
                <strong>${this._formatPower(pvW)}</strong>
              </div>

              <div class="stat">
                <span>Home</span>
                <strong>${this._formatPower(homeW)}</strong>
              </div>

              <div class="stat">
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

              <div class="stat">
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
          </div>
        </ha-card>
      `;
    }

    _styles() {
      return `
        :host {
          display: block;
          --vn-card-radius: var(--ha-card-border-radius, 16px);
          --vn-card-bg: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          --vn-primary-text: var(--primary-text-color, #f5f5f5);
          --vn-secondary-text: var(--secondary-text-color, #a7a7a7);
          --vn-border: rgba(255, 255, 255, 0.12);
          --vn-node-bg: rgba(255, 255, 255, 0.08);
          --vn-node-bg-strong: rgba(255, 255, 255, 0.13);
          --vn-pv: #ffb300;
          --vn-home: #42a5f5;
          --vn-grid: #ab47bc;
          --vn-battery: #66bb6a;
          --vn-export: #26c6da;
          --vn-muted: rgba(255, 255, 255, 0.18);
        }

        ha-card {
          overflow: hidden;
          border-radius: var(--vn-card-radius);
          background:
            radial-gradient(circle at 20% 0%, rgba(255, 179, 0, 0.16), transparent 32%),
            radial-gradient(circle at 90% 20%, rgba(66, 165, 245, 0.13), transparent 28%),
            var(--vn-card-bg);
          color: var(--vn-primary-text);
        }

        .card {
          padding: 16px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 10px;
        }

        .title {
          font-size: 18px;
          font-weight: 700;
          line-height: 1.15;
        }

        .subtitle {
          margin-top: 3px;
          font-size: 12px;
          color: var(--vn-secondary-text);
        }

        .sky-pill {
          border: 1px solid var(--vn-border);
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 12px;
          white-space: nowrap;
          color: var(--vn-secondary-text);
        }

        .sky-clear {
          color: #ffd54f;
        }

        .sky-partly_cloudy,
        .sky-partlycloudy,
        .sky-cloudy,
        .sky-overcast {
          color: #b0bec5;
        }

        .sky-snow,
        .sky-snowy,
        .sky-snow_or_blocked,
        .sky-blocked {
          color: #e1f5fe;
        }

        .sky-night {
          color: #90caf9;
        }

        .warning {
          border: 1px solid rgba(255, 193, 7, 0.35);
          background: rgba(255, 193, 7, 0.10);
          color: var(--vn-primary-text);
          border-radius: 12px;
          padding: 8px 10px;
          margin: 8px 0 10px;
          font-size: 12px;
        }

        .stage {
          position: relative;
          height: 330px;
          border: 1px solid var(--vn-border);
          border-radius: 18px;
          overflow: hidden;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.05),
            rgba(255, 255, 255, 0.025)
          );
        }

        .stage.sky-night {
          background:
            radial-gradient(circle at 18% 16%, rgba(144, 202, 249, 0.16), transparent 24%),
            linear-gradient(180deg, rgba(13, 27, 42, 0.7), rgba(0, 0, 0, 0.12));
        }

        .stage.sky-clear {
          background:
            radial-gradient(circle at 18% 16%, rgba(255, 213, 79, 0.20), transparent 24%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.025));
        }

        .flow-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .flow {
          fill: none;
          stroke: var(--vn-muted);
          stroke-width: calc(2px + (var(--power, 0.2) * 7px));
          stroke-linecap: round;
          stroke-dasharray: 9 13;
          opacity: 0.3;
          transition: opacity 0.35s ease, stroke-width 0.35s ease;
        }

        .flow.active {
          opacity: 0.95;
          filter: url(#vnGlow);
          animation: flowForward 1.15s linear infinite;
        }

        .flow.active.reverse {
          animation-name: flowReverse;
        }

        .flow.inactive {
          stroke-dasharray: none;
        }

        .flow.pv,
        .flow.decorative {
          stroke: var(--vn-pv);
        }

        .flow.battery {
          stroke: var(--vn-battery);
        }

        .flow.grid {
          stroke: var(--vn-grid);
        }

        .flow.export {
          stroke: var(--vn-export);
        }

        @keyframes flowForward {
          from {
            stroke-dashoffset: 0;
          }

          to {
            stroke-dashoffset: -44;
          }
        }

        @keyframes flowReverse {
          from {
            stroke-dashoffset: 0;
          }

          to {
            stroke-dashoffset: 44;
          }
        }

        .node {
          position: absolute;
          width: 120px;
          min-height: 74px;
          box-sizing: border-box;
          padding: 10px;
          border: 1px solid var(--vn-border);
          border-radius: 16px;
          background: var(--vn-node-bg);
          backdrop-filter: blur(8px);
          text-align: center;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        }

        .node.primary {
          background: var(--vn-node-bg-strong);
        }

        .icon {
          font-size: 22px;
          line-height: 1;
          margin-bottom: 4px;
        }

        .node-title {
          font-size: 12px;
          color: var(--vn-secondary-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .node-value {
          margin-top: 3px;
          font-weight: 700;
          font-size: 16px;
        }

        .sun-node {
          left: 34px;
          top: 18px;
          background: transparent;
          border: 0;
          box-shadow: none;
          width: 130px;
        }

        .sun-wrap {
          position: relative;
          width: 70px;
          height: 70px;
          margin: 0 auto 2px;
        }

        .sun-rays {
          position: absolute;
          inset: 4px;
          border-radius: 999px;
          background: conic-gradient(
            from 0deg,
            rgba(255, 193, 7, 0.9),
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
          animation: spinSun 16s linear infinite;
          filter: blur(0.2px);
        }

        .sun-core {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 45px;
          height: 45px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 32px;
          background: rgba(255, 193, 7, 0.20);
          box-shadow: 0 0 26px rgba(255, 193, 7, 0.55);
        }

        .sun-node.night .sun-rays,
        .sun-node.low .sun-rays {
          opacity: 0.2;
          animation-duration: 35s;
        }

        .sun-node.night .sun-core {
          filter: grayscale(1);
          opacity: 0.55;
          box-shadow: 0 0 18px rgba(144, 202, 249, 0.25);
        }

        @keyframes spinSun {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        .pv-node {
          left: 188px;
          top: 118px;
        }

        .home-node {
          left: 340px;
          top: 223px;
        }

        .battery-node {
          right: 64px;
          top: 118px;
        }

        .grid-node {
          right: 48px;
          bottom: 34px;
        }

        .battery-bar {
          height: 7px;
          margin-top: 7px;
          border-radius: 999px;
          border: 1px solid var(--vn-border);
          overflow: hidden;
          background: rgba(255, 255, 255, 0.08);
        }

        .battery-fill {
          height: 100%;
          width: var(--soc, 0%);
          background: var(--vn-battery);
          border-radius: 999px;
        }

        .cloud-layer {
          position: absolute;
          left: 92px;
          top: 50px;
          width: 245px;
          height: 115px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.45s ease;
        }

        .cloud-layer.visible {
          opacity: 1;
        }

        .cloud {
          position: absolute;
          width: 86px;
          height: 31px;
          border-radius: 999px;
          background: rgba(236, 239, 241, 0.82);
          box-shadow: 0 0 18px rgba(255, 255, 255, 0.22);
          animation: cloudDrift 7s ease-in-out infinite alternate;
        }

        .cloud::before,
        .cloud::after {
          content: "";
          position: absolute;
          bottom: 10px;
          border-radius: 999px;
          background: inherit;
        }

        .cloud::before {
          left: 12px;
          width: 34px;
          height: 34px;
        }

        .cloud::after {
          left: 38px;
          width: 42px;
          height: 42px;
        }

        .cloud-a {
          left: 24px;
          top: 24px;
          transform: scale(1.05);
        }

        .cloud-b {
          left: 98px;
          top: 46px;
          transform: scale(0.82);
          animation-duration: 9s;
        }

        .cloud-c {
          left: 144px;
          top: 14px;
          transform: scale(0.68);
          animation-duration: 10s;
          opacity: 0.8;
        }

        @keyframes cloudDrift {
          from {
            margin-left: -8px;
          }

          to {
            margin-left: 14px;
          }
        }

        .snow-layer {
          position: absolute;
          left: 128px;
          top: 84px;
          width: 170px;
          height: 130px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.45s ease;
        }

        .snow-layer.visible {
          opacity: 1;
        }

        .snow-layer span {
          position: absolute;
          color: rgba(225, 245, 254, 0.95);
          animation: snowFall 3.4s linear infinite;
        }

        .snow-layer span:nth-child(1) {
          left: 18px;
          animation-delay: 0s;
        }

        .snow-layer span:nth-child(2) {
          left: 60px;
          animation-delay: 0.7s;
        }

        .snow-layer span:nth-child(3) {
          left: 101px;
          animation-delay: 1.4s;
        }

        .snow-layer span:nth-child(4) {
          left: 139px;
          animation-delay: 2.1s;
        }

        @keyframes snowFall {
          from {
            transform: translateY(0) rotate(0deg);
            opacity: 0;
          }

          20% {
            opacity: 1;
          }

          to {
            transform: translateY(98px) rotate(180deg);
            opacity: 0;
          }
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }

        .stat {
          border: 1px solid var(--vn-border);
          border-radius: 12px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.055);
          min-width: 0;
        }

        .stat span {
          display: block;
          font-size: 11px;
          color: var(--vn-secondary-text);
          margin-bottom: 2px;
        }

        .stat strong {
          display: block;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 480px) {
          .stage {
            height: 300px;
          }

          .node {
            width: 102px;
            padding: 8px;
          }

          .node-value {
            font-size: 14px;
          }

          .sun-node {
            left: 10px;
            top: 12px;
            transform: scale(0.92);
            transform-origin: top left;
          }

          .pv-node {
            left: 120px;
            top: 112px;
          }

          .home-node {
            left: 136px;
            top: 218px;
          }

          .battery-node {
            right: 10px;
            top: 112px;
          }

          .grid-node {
            right: 12px;
            bottom: 26px;
          }

          .stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `;
    }

    _warning(missingEntities) {
      return `
        <div class="warning">
          Missing or unavailable entities:
          ${missingEntities.map((entity) => this._escape(entity)).join(", ")}
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

      return labels[value] || value.replace(/_/g, " ");
    }

    _sunValue(entity) {
      const state = this._readState(entity || "sun.sun");
      const elevation = this._readAttributeNumber(entity || "sun.sun", "elevation");

      if (Number.isFinite(elevation)) {
        return `${Math.round(elevation)}°`;
      }

      if (!state || ["unknown", "unavailable"].includes(state)) return "—";

      return state === "above_horizon" ? "Up" : "Down";
    }

    _batteryBar(value) {
      const soc = this._clamp(value, 0, 100);

      return `
        <div class="battery-bar" title="${Math.round(soc)}%">
          <div class="battery-fill" style="--soc: ${soc}%"></div>
        </div>
      `;
    }

    _flowClass(active) {
      return active ? "active" : "inactive";
    }

    _flowStrength(value, maxPower) {
      const strength = this._clamp(Math.abs(value) / maxPower, 0.14, 1);
      return strength.toFixed(3);
    }

    _readPower(entityId) {
      if (!entityId || !this._hass || !this._hass.states[entityId]) return 0;

      const entity = this._hass.states[entityId];
      const raw = Number.parseFloat(String(entity.state).replace(",", "."));

      if (!Number.isFinite(raw)) return 0;

      const unit = String(entity.attributes?.unit_of_measurement || "").toLowerCase();

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

      if (!Number.isFinite(abs)) return "—";

      if (abs >= 1000) {
        return `${(abs / 1000).toFixed(abs >= 10000 ? 1 : 2)} kW`;
      }

      return `${Math.round(abs)} W`;
    }

    _formatSignedPower(value) {
      if (!Number.isFinite(value)) return "—";
      if (Math.abs(value) < 0.5) return "0 W";

      const sign = value > 0 ? "+" : "−";

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