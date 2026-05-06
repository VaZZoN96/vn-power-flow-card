/*
 * VN Power Flow Card
 * Real-time power flow card for Home Assistant
 * Layout v0.5.0
 */

(() => {
  const CARD_VERSION = "0.5.0";
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

  const SNOW_STATES = new Set(["snow", "snowy", "snow_or_blocked", "blocked"]);

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

    static getConfigElement() {
      ensureEditorDefined();
      return document.createElement(EDITOR_TAG);
    }

    setConfig(config) {
      if (!config) throw new Error("Invalid configuration");
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
      const gridRawW = this._readPower(c.grid_power || c.grid_active_power || c.grid_power_alt);
      const batteryRawW = this._readPower(c.battery_power);
      const batterySoc = this._firstNumber([c.battery_soc, c.goodwe_battery_soc]);
      const batteryCurrent = this._firstNumber([c.battery_current, c.goodwe_battery_curr]);
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

      const gridPositiveDirection = String(c.grid_positive_direction || "import").toLowerCase();
      const batteryPositiveDirection = String(c.battery_positive_direction || "discharge").toLowerCase();

      const gridImportW = gridPositiveDirection === "import" ? Math.max(0, gridRawW) : Math.max(0, -gridRawW);
      const gridExportW = gridPositiveDirection === "import" ? Math.max(0, -gridRawW) : Math.max(0, gridRawW);
      const batteryDischargeW = batteryPositiveDirection === "discharge" ? Math.max(0, batteryRawW) : Math.max(0, -batteryRawW);
      const batteryChargeW = batteryPositiveDirection === "discharge" ? Math.max(0, -batteryRawW) : Math.max(0, batteryRawW);

      const skyState = this._skyState(c);
      const showClouds = this._bool(c.show_clouds, true) && CLOUDY_STATES.has(skyState);
      const showSnow = this._bool(c.show_snow, true) && SNOW_STATES.has(skyState);
      const sun = this._sunData(c.sun_entity || "sun.sun");
      const missingEntities = this._missingEntities(c, this._hass);
      const activePower = pvW + homeW + gridImportW + gridExportW + batteryChargeW + batteryDischargeW;
      const status = activePower > threshold ? "FLOW" : "IDLE";

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
            ${this._bool(c.show_header, true) ? `
              <div class="vnp-topbar">
                <div class="vnp-title-wrap">
                  <div class="vnp-title">⚡ ${this._escape(c.title || "VN Power Flow")}</div>
                  <div class="vnp-subtitle">Real-time power flow card for Home Assistant</div>
                </div>
                <div class="vnp-status ${status === "FLOW" ? "vnp-status-flow" : ""}">${status}</div>
              </div>
            ` : ""}

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
                  <span>❄</span><span>❄</span><span>❄</span><span>❄</span>
                </div>
              </section>

              <section class="vnp-flow-area" aria-label="Power flow">
                <svg class="vnp-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <filter id="vnpGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="0.55" result="blur"></feGaussianBlur>
                      <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
                    </filter>
                  </defs>

                  <path class="vnp-flow vnp-flow-sun ${this._flowClass(flows.sunToPv)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}; --duration:${this._flowDuration(pvW, maxPower)}s;"
                    d="M50 0 C50 8 50 13 50 20"></path>

                  <path class="vnp-flow vnp-flow-pv ${this._flowClass(flows.pvToInverter)}"
                    style="--power:${this._flowStrength(pvW, maxPower)}; --duration:${this._flowDuration(pvW, maxPower)}s;"
                    d="M50 24 C50 32 50 38 50 43"></path>

                  <path class="vnp-flow vnp-flow-home ${this._flowClass(flows.inverterToHome)}"
                    style="--power:${this._flowStrength(homeW, maxPower)}; --duration:${this._flowDuration(homeW, maxPower)}s;"
                    d="M50 55 C50 66 50 74 50 82"></path>

                  <path class="vnp-flow vnp-flow-grid ${this._flowClass(flows.gridImport)}"
                    style="--power:${this._flowStrength(gridImportW, maxPower)}; --duration:${this._flowDuration(gridImportW, maxPower)}s;"
                    d="M21 49 C31 49 39 49 46 49"></path>

                  <path class="vnp-flow vnp-flow-export ${this._flowClass(flows.gridExport)} vnp-reverse"
                    style="--power:${this._flowStrength(gridExportW, maxPower)}; --duration:${this._flowDuration(gridExportW, maxPower)}s;"
                    d="M21 49 C31 49 39 49 46 49"></path>

                  <path class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryCharge)}"
                    style="--power:${this._flowStrength(batteryChargeW, maxPower)}; --duration:${this._flowDuration(batteryChargeW, maxPower)}s;"
                    d="M54 49 C61 49 69 49 79 49"></path>

                  <path class="vnp-flow vnp-flow-battery ${this._flowClass(flows.batteryDischarge)} vnp-reverse"
                    style="--power:${this._flowStrength(batteryDischargeW, maxPower)}; --duration:${this._flowDuration(batteryDischargeW, maxPower)}s;"
                    d="M54 49 C61 49 69 49 79 49"></path>
                </svg>

                <div class="vnp-pv-badge">
                  <span>${this._escape(names.pv)}</span>
                  <strong>${this._formatPower(pvW)}</strong>
                  <small>${this._pvSubText(pv1W, pv2W, c)}</small>
                </div>

                <div class="vnp-inverter" aria-label="Inverter">
                  ${this._inverterSvg()}
                </div>

                <div class="vnp-grid-node">
                  ${this._pylonSvg()}
                  <div class="vnp-side-value">${this._formatSignedPower(gridRawW)}</div>
                  <div class="vnp-side-sub">${gridImportW >= gridExportW ? "Import" : "Export"} ${gridImportW >= gridExportW ? this._formatPower(gridImportW) : this._formatPower(gridExportW)}</div>
                </div>

                <div class="vnp-battery-node">
                  ${this._batterySvg(batterySoc)}
                  <div class="vnp-battery-value">${this._formatSignedPower(batteryRawW)}</div>
                  <div class="vnp-battery-sub">${Number.isFinite(batterySoc) ? `${Math.round(batterySoc)}%` : "--%"} / ${Number.isFinite(batteryVoltage) ? this._formatNumber(batteryVoltage, "V", 1) : "-- V"} / ${Number.isFinite(batteryCurrent) ? this._formatNumber(batteryCurrent, "A", 1) : "-- A"}</div>
                </div>

                <div class="vnp-home-node">
                  ${this._homeSvg()}
                  <div class="vnp-home-value">${this._formatPower(homeW)}</div>
                  <div class="vnp-home-sub">${this._formatEnergy(todayLoad)}</div>
                </div>
              </section>
            </div>

            ${this._bool(c.show_details, true) ? `
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
            ` : ""}
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
          background: radial-gradient(circle at 50% 0%, rgba(255, 213, 79, 0.11), transparent 32%), var(--vnp-card-bg);
          color: var(--vnp-text);
        }

        .vnp-card { box-sizing: border-box; padding: 14px; }
        .vnp-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .vnp-title-wrap { min-width: 0; }
        .vnp-title { overflow: hidden; font-size: 18px; font-weight: 800; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-subtitle { margin-top: 3px; color: var(--vnp-muted); font-size: 12px; line-height: 1.25; }
        .vnp-status { flex: 0 0 auto; border: 1px solid var(--vnp-border); border-radius: 999px; padding: 6px 11px; background: rgba(255,255,255,.08); color: var(--vnp-muted); font-size: 12px; font-weight: 800; letter-spacing: .06em; }
        .vnp-status-flow { color: var(--vnp-sun); box-shadow: 0 0 22px rgba(255,213,79,.20); }
        .vnp-warning { border: 1px solid rgba(255,193,7,.38); background: rgba(255,193,7,.11); border-radius: 12px; padding: 9px 10px; margin: 0 0 10px; font-size: 12px; line-height: 1.35; }

        .vnp-stage { overflow: hidden; border: 1px solid var(--vnp-border); border-radius: 18px; background: linear-gradient(180deg, rgba(31,42,56,.92), rgba(10,15,22,.55)); }
        .vnp-stage.vnp-sky-clear { background: radial-gradient(circle at 50% 8%, rgba(255,213,79,.18), transparent 28%), linear-gradient(180deg, rgba(30,51,72,.92), rgba(10,15,22,.52)); }
        .vnp-stage.vnp-sky-night { background: radial-gradient(circle at 50% 8%, rgba(144,202,249,.14), transparent 28%), linear-gradient(180deg, rgba(9,17,32,.96), rgba(4,7,14,.68)); }

        .vnp-sky { position: relative; height: 150px; border-bottom: 1px solid rgba(255,255,255,.09); }
        .vnp-sky-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .vnp-sun-arc { fill: none; stroke: rgba(255,213,79,.66); stroke-width: 1.1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
        .vnp-horizon { stroke: rgba(255,255,255,.16); stroke-width: .9; vector-effect: non-scaling-stroke; }
        .vnp-tick { fill: rgba(255,255,255,.45); }
        .vnp-time { position: absolute; bottom: 14px; transform: translateX(-50%); color: var(--vnp-muted); font-size: 11px; font-weight: 700; }
        .vnp-time-rise { left: 8%; } .vnp-time-noon { left: 50%; } .vnp-time-set { left: 92%; }

        .vnp-sun-marker { position: absolute; left: calc(var(--sun-x) * 1%); top: calc(var(--sun-y) * 1%); z-index: 7; width: 48px; height: 48px; transform: translate(-50%, -50%); }
        .vnp-sun-glow { position: absolute; inset: 4px; border-radius: 999px; background: radial-gradient(circle, rgba(255,244,179,.38), rgba(255,213,79,.11) 48%, transparent 74%); box-shadow: 0 0 15px rgba(255,213,79,.22); }
        .vnp-sun-core { position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; transform: translate(-50%, -50%); display: grid; place-items: center; border-radius: 999px; background: rgba(255,213,79,.17); box-shadow: 0 0 10px rgba(255,213,79,.24); font-size: 22px; }
        .vnp-moon .vnp-sun-glow { background: radial-gradient(circle, rgba(144,202,249,.24), transparent 72%); box-shadow: 0 0 14px rgba(144,202,249,.18); }
        .vnp-moon .vnp-sun-core { background: rgba(144,202,249,.12); box-shadow: 0 0 14px rgba(144,202,249,.24); }

        .vnp-cloud-layer { position: absolute; z-index: 8; left: 28%; top: 46%; width: 44%; height: 38%; opacity: 0; pointer-events: none; transition: opacity .35s ease; }
        .vnp-cloud-layer.vnp-visible { opacity: 1; }
        .vnp-cloud { position: absolute; width: 32%; height: 28%; border-radius: 999px; background: rgba(236,239,241,.84); box-shadow: 0 0 12px rgba(255,255,255,.16); animation: vnpCloud 10s ease-in-out infinite alternate; }
        .vnp-cloud::before, .vnp-cloud::after { content: ""; position: absolute; bottom: 30%; border-radius: 999px; background: inherit; }
        .vnp-cloud::before { left: 14%; width: 42%; height: 110%; }
        .vnp-cloud::after { left: 48%; width: 54%; height: 135%; }
        .vnp-cloud-a { left: 8%; top: 30%; } .vnp-cloud-b { left: 40%; top: 44%; transform: scale(.80); animation-duration: 12s; } .vnp-cloud-c { left: 60%; top: 10%; transform: scale(.68); opacity: .78; animation-duration: 14s; }
        @keyframes vnpCloud { from { margin-left: -2%; } to { margin-left: 4%; } }

        .vnp-snow-layer { position: absolute; z-index: 9; left: 36%; top: 50%; width: 28%; height: 44%; opacity: 0; pointer-events: none; transition: opacity .35s ease; }
        .vnp-snow-layer.vnp-visible { opacity: 1; }
        .vnp-snow-layer span { position: absolute; top: 0; color: rgba(225,245,254,.95); animation: vnpSnow 3.8s linear infinite; }
        .vnp-snow-layer span:nth-child(1) { left: 8%; animation-delay: 0s; } .vnp-snow-layer span:nth-child(2) { left: 34%; animation-delay: .7s; } .vnp-snow-layer span:nth-child(3) { left: 62%; animation-delay: 1.4s; } .vnp-snow-layer span:nth-child(4) { left: 88%; animation-delay: 2.1s; }
        @keyframes vnpSnow { from { transform: translateY(0) rotate(0deg); opacity: 0; } 20% { opacity: 1; } to { transform: translateY(58px) rotate(180deg); opacity: 0; } }

        .vnp-flow-area { position: relative; min-height: 470px; }
        .vnp-flow-svg { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; pointer-events: none; }
        .vnp-flow { fill: none; stroke: rgba(255,255,255,.18); stroke-width: calc(1px + (var(--power, .2) * 2.2px)); stroke-linecap: square; stroke-linejoin: round; stroke-dasharray: 8 8; opacity: .24; vector-effect: non-scaling-stroke; }
        .vnp-flow.vnp-active { opacity: .96; filter: url(#vnpGlow); animation: vnpFlow var(--duration, 1.8s) linear infinite; }
        .vnp-flow.vnp-reverse { animation-direction: reverse; }
        .vnp-flow.vnp-inactive { stroke-dasharray: none; }
        .vnp-flow-sun { stroke: var(--vnp-sun); } .vnp-flow-pv { stroke: var(--vnp-pv); } .vnp-flow-home { stroke: var(--vnp-home); } .vnp-flow-grid { stroke: var(--vnp-grid); } .vnp-flow-export { stroke: var(--vnp-export); } .vnp-flow-battery { stroke: var(--vnp-battery); }
        @keyframes vnpFlow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -16; } }

        .vnp-pv-badge, .vnp-inverter, .vnp-grid-node, .vnp-battery-node, .vnp-home-node { position: absolute; z-index: 3; box-sizing: border-box; transform: translate(-50%, -50%); }
        .vnp-pv-badge { left: 50%; top: 20%; width: clamp(112px, 23%, 152px); border: 1px solid rgba(255,213,79,.32); border-radius: 13px; background: rgba(255,179,0,.10); box-shadow: 0 0 18px rgba(255,179,0,.10); padding: 8px 10px; text-align: center; backdrop-filter: blur(7px); }
        .vnp-pv-badge span, .vnp-pv-badge small { display: block; color: var(--vnp-muted); font-size: 11px; font-weight: 800; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-pv-badge strong { display: block; margin: 3px 0; color: var(--vnp-text); font-size: 18px; font-weight: 900; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .vnp-inverter { left: 50%; top: 49%; width: clamp(132px, 24%, 180px); height: clamp(100px, 20%, 134px); display: grid; place-items: center; background: transparent; }
        .vnp-inverter svg { display: block; width: 100%; height: 100%; overflow: visible; }

        .vnp-grid-node { left: 18%; top: 49%; width: clamp(104px, 22%, 132px); min-height: 148px; border: 1px solid var(--vnp-border); border-radius: 16px; background: var(--vnp-panel); padding: 8px; text-align: center; backdrop-filter: blur(8px); }
        .vnp-grid-node svg { display: block; width: 100%; height: 78px; margin: 0 auto 5px; }
        .vnp-side-value, .vnp-battery-value, .vnp-home-value { overflow: hidden; color: var(--vnp-text); font-size: 16px; font-weight: 900; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-side-sub, .vnp-battery-sub, .vnp-home-sub { margin-top: 4px; overflow: hidden; color: var(--vnp-muted); font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }

        .vnp-battery-node { left: 82%; top: 49%; width: clamp(104px, 22%, 132px); border: 1px solid var(--vnp-border); border-radius: 16px; background: var(--vnp-panel); padding: 8px; text-align: center; backdrop-filter: blur(8px); }
        .vnp-battery-node svg { display: block; width: 100%; height: 118px; margin: 0 auto 6px; overflow: visible; }

        .vnp-home-node { left: 50%; top: 84%; width: clamp(138px, 30%, 188px); border: 1px solid var(--vnp-border); border-radius: 18px; background: var(--vnp-panel); padding: 10px; text-align: center; backdrop-filter: blur(8px); }
        .vnp-home-node svg { display: block; width: 92px; height: 68px; margin: 0 auto 6px; overflow: visible; }
        .vnp-home-value { font-size: 18px; }

        .vnp-details { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
        .vnp-detail { min-width: 0; border: 1px solid var(--vnp-border); border-radius: 13px; background: rgba(255,255,255,.055); padding: 8px; }
        .vnp-detail-icon { display: inline-block; margin-right: 4px; opacity: .9; }
        .vnp-detail-label { display: block; overflow: hidden; color: var(--vnp-muted); font-size: 11px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
        .vnp-detail-value { display: block; overflow: hidden; margin-top: 3px; font-size: 13px; font-weight: 900; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }

        @media (max-width: 620px) {
          .vnp-card { padding: 12px; }
          .vnp-subtitle { display: none; }
          .vnp-sky { height: 132px; }
          .vnp-flow-area { min-height: 510px; }
          .vnp-pv-badge { top: 18%; width: 116px; }
          .vnp-inverter { top: 47%; width: 118px; height: 92px; }
          .vnp-grid-node { left: 16%; top: 48%; width: 96px; min-height: 132px; padding: 7px; }
          .vnp-grid-node svg { height: 66px; }
          .vnp-battery-node { left: 84%; top: 48%; width: 96px; }
          .vnp-battery-node svg { height: 98px; }
          .vnp-home-node { top: 84%; width: 148px; }
          .vnp-home-node svg { width: 80px; height: 60px; }
          .vnp-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 390px) {
          .vnp-title { font-size: 16px; }
          .vnp-status { padding: 6px 9px; font-size: 11px; }
          .vnp-flow-area { min-height: 520px; }
          .vnp-grid-node { left: 15%; width: 88px; }
          .vnp-battery-node { left: 85%; width: 88px; }
          .vnp-inverter { width: 110px; height: 86px; }
          .vnp-pv-badge { width: 108px; }
          .vnp-side-value, .vnp-battery-value, .vnp-home-value { font-size: 15px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vnp-flow.vnp-active, .vnp-cloud, .vnp-snow-layer span { animation: none; }
        }
      `;
    }

    _detailBox(label, value, icon) {
      return `<div class="vnp-detail"><span class="vnp-detail-label"><span class="vnp-detail-icon">${icon}</span>${this._escape(label)}</span><span class="vnp-detail-value">${this._escape(value)}</span></div>`;
    }

    _warning(missingEntities) {
      return `<div class="vnp-warning">Missing or unavailable entities: ${missingEntities.map((e) => this._escape(e)).join(", ")}</div>`;
    }

    _missingEntities(config, hass) {
      if (!hass) return [];
      const keys = ["pv_power", "pv_total_power", "pv1_power", "pv2_power", "home_power", "consump", "grid_power", "grid_active_power", "grid_power_alt", "battery_power", "battery_soc", "goodwe_battery_soc", "sun_entity", "pv_sky_state", "weather_entity"];
      return keys.map((key) => config[key]).filter((entity) => entity && !hass.states[entity]);
    }

    _skyState(config) {
      const mode = String(config.cloud_mode || "auto").toLowerCase();
      if (mode === "off") return "clear";

      if ((mode === "entity" || mode === "auto") && config.pv_sky_state) {
        const entityState = this._readState(config.pv_sky_state);
        if (entityState && !["unknown", "unavailable"].includes(entityState)) return this._normalizeSkyState(entityState);
      }

      const sunEntity = config.sun_entity || "sun.sun";
      const sunState = this._readState(sunEntity);
      const elevation = this._readAttributeNumber(sunEntity, "elevation");
      if (sunState === "below_horizon") return "night";
      if (Number.isFinite(elevation) && elevation < 6) return "low_sun";

      if (config.weather_entity) {
        const weatherState = this._readState(config.weather_entity);
        if (weatherState && !["unknown", "unavailable"].includes(weatherState)) return this._normalizeSkyState(weatherState);
      }
      return "clear";
    }

    _normalizeSkyState(value) {
      const normalized = String(value || "unknown").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
      const map = { sunny: "clear", clear_sky: "clear", clear: "clear", partlycloudy: "partly_cloudy", partly_cloudy: "partly_cloudy", cloudy: "cloudy", overcast: "overcast", rainy: "rainy", pouring: "rainy", snow: "snow", snowy: "snow", snow_or_blocked: "snow_or_blocked", blocked: "blocked", low_sun: "low_sun", night: "night" };
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

    _flowClass(active) { return active ? "vnp-active" : "vnp-inactive"; }
    _flowStrength(value, maxPower) { return this._clamp(Math.abs(value) / maxPower, 0.18, 1).toFixed(3); }
    _flowDuration(value, maxPower) { return (2.8 - this._clamp(Math.abs(value) / maxPower, 0, 1) * 1.5).toFixed(2); }

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

    _formatEnergy(value) { return Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)} kWh` : "-- kWh"; }
    _formatTemp(value) { return Number.isFinite(value) ? `${value.toFixed(0)} °C` : "-- °C"; }
    _formatNumber(value, unit, decimals) { return Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : `-- ${unit}`; }
    _formatNumberOrDash(value, unit, decimals) { return this._formatNumber(value, unit, decimals); }
    _batterySoc(value) { return Number.isFinite(value) ? this._clamp(value, 0, 100) : 0; }
    _socColor(value) { if (!Number.isFinite(value)) return "#607d8b"; if (value <= 20) return "#ff3d00"; if (value <= 40) return "#f4d03f"; if (value <= 75) return "#44d66a"; return "#00bcd4"; }
    _number(value, fallback) { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback; }
    _bool(value, fallback) { if (value === undefined || value === null) return fallback; if (typeof value === "boolean") return value; return !["false", "0", "no", "off"].includes(String(value).toLowerCase()); }
    _clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
    _escape(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
    _escapeAttr(value) { return this._escape(value).replace(/[^a-zA-Z0-9_-]/g, "_"); }

    _inverterSvg() {
      return `
        <svg viewBox="0 0 180 128" role="img" aria-label="Inverter">
          <defs>
            <linearGradient id="vnpInvFront" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#eef4ef"></stop>
              <stop offset="1" stop-color="#cfd8d2"></stop>
            </linearGradient>
            <linearGradient id="vnpInvSide" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#3c4649"></stop>
              <stop offset="1" stop-color="#20272a"></stop>
            </linearGradient>
            <linearGradient id="vnpInvPanel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#262a2e"></stop>
              <stop offset="1" stop-color="#0f1215"></stop>
            </linearGradient>
          </defs>
          <g filter="drop-shadow(0 12px 14px rgba(0,0,0,.30))">
            <path d="M35 15 L136 10 L160 29 L160 108 L59 117 L35 96 Z" fill="url(#vnpInvSide)"></path>
            <path d="M22 22 Q22 14 30 14 L132 14 Q140 14 140 22 L140 101 Q140 109 132 109 L30 109 Q22 109 22 101 Z" fill="url(#vnpInvFront)" stroke="rgba(255,255,255,.80)" stroke-width="2"></path>
            <path d="M140 22 L160 37 L160 108 L140 101 Z" fill="url(#vnpInvSide)"></path>
            <circle cx="35" cy="27" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="127" cy="25" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="35" cy="96" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <circle cx="127" cy="96" r="3" fill="#aeb8b5" stroke="#7c8584" stroke-width="1.3"></circle>
            <rect x="48" y="62" width="72" height="31" rx="5" fill="url(#vnpInvPanel)" stroke="rgba(255,255,255,.78)" stroke-width="1.6"></rect>
            <rect x="58" y="69" width="28" height="14" rx="1.8" fill="rgba(140,151,150,.45)"></rect>
            <rect x="48" y="62" width="72" height="7" rx="5" fill="#7ac943"></rect>
            <circle cx="105" cy="74" r="2" fill="#7ac943"></circle>
            <circle cx="105" cy="84" r="2" fill="#7ac943"></circle>
            <circle cx="105" cy="94" r="2" fill="#ef5350"></circle>
            <path d="M61 90 H96" stroke="rgba(255,255,255,.8)" stroke-width="2" stroke-linecap="round"></path>
          </g>
        </svg>
      `;
    }

    _batterySvg(soc) {
      const level = this._batterySoc(soc);
      const y = 82 - level * 0.62;
      const h = level * 0.62;
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
            <rect x="39" y="10" width="42" height="12" rx="4" fill="rgba(255,255,255,.48)"></rect>
            <rect x="28" y="20" width="64" height="78" rx="11" fill="rgba(0,0,0,.24)" stroke="url(#vnpBattShell)" stroke-width="4"></rect>
            <rect x="34" y="${y}" width="52" height="${h}" rx="6" fill="${color}"></rect>
            <path d="M38 34 H82 M38 50 H82 M38 66 H82" stroke="rgba(255,255,255,.22)" stroke-width="2"></path>
            <path d="M51 45 L64 45 L57 59 L70 59 L53 82 L58 64 L47 64 Z" fill="rgba(255,255,255,.86)"></path>
          </g>
        </svg>
      `;
    }

    _pylonSvg() {
      return `
        <svg viewBox="0 0 120 90" role="img" aria-label="Grid pylon">
          <g fill="none" stroke="rgba(220,226,234,.90)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M32 82 L48 16 L64 82"></path><path d="M40 48 H56"></path><path d="M37 62 H59"></path><path d="M48 16 L30 31 H66 Z"></path><path d="M40 48 L59 62"></path><path d="M56 48 L37 62"></path>
            <path d="M80 82 L91 34 L102 82"></path><path d="M85 56 H97"></path><path d="M91 34 L78 45 H104 Z"></path><path d="M6 31 C24 26 42 26 60 31 C78 36 96 36 114 31"></path>
          </g>
        </svg>
      `;
    }

    _homeSvg() {
      return `
        <svg viewBox="0 0 140 100" role="img" aria-label="Home consumption">
          <defs>
            <linearGradient id="vnpHomeWall" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(240,246,250,.95)"></stop>
              <stop offset="1" stop-color="rgba(180,194,204,.80)"></stop>
            </linearGradient>
            <linearGradient id="vnpHomeRoof" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="rgba(79,195,247,.95)"></stop>
              <stop offset="1" stop-color="rgba(37,94,128,.95)"></stop>
            </linearGradient>
          </defs>
          <g filter="drop-shadow(0 8px 10px rgba(0,0,0,.22))">
            <path d="M18 49 L70 13 L122 49 L114 59 L70 29 L26 59 Z" fill="url(#vnpHomeRoof)" stroke="rgba(255,255,255,.55)" stroke-width="2"></path>
            <path d="M32 53 H108 V88 H32 Z" fill="url(#vnpHomeWall)" stroke="rgba(255,255,255,.55)" stroke-width="2"></path>
            <rect x="61" y="65" width="18" height="23" rx="2" fill="rgba(58,74,84,.72)"></rect>
            <rect x="43" y="62" width="13" height="12" rx="2" fill="rgba(79,195,247,.55)"></rect>
            <rect x="84" y="62" width="13" height="12" rx="2" fill="rgba(79,195,247,.55)"></rect>
            <path d="M28 88 H112" stroke="rgba(255,255,255,.50)" stroke-width="4" stroke-linecap="round"></path>
          </g>
        </svg>
      `;
    }
  }

  function ensureEditorDefined() {
    if (customElements.get(EDITOR_TAG)) return;

    customElements.define(EDITOR_TAG, class VNPowerFlowCardEditor extends HTMLElement {
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
            .vnp-editor { display: grid; gap: 10px; padding: 8px 0; }
            .vnp-editor label { display: grid; gap: 4px; font-size: 12px; color: var(--secondary-text-color); }
            .vnp-editor input, .vnp-editor select { box-sizing: border-box; width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, #555); background: var(--card-background-color, #111); color: var(--primary-text-color, #fff); }
            .vnp-note { color: var(--secondary-text-color); font-size: 12px; line-height: 1.35; }
          </style>
          <div class="vnp-editor">
            ${this._field("title", "Title", c.title || "VN Power Flow")}
            ${this._field("pv_power", "PV power entity", c.pv_power || "")}
            ${this._field("home_power", "Home power entity", c.home_power || "")}
            ${this._field("grid_power", "Grid power entity", c.grid_power || "")}
            ${this._field("battery_power", "Battery power entity", c.battery_power || "")}
            ${this._field("battery_soc", "Battery SOC entity", c.battery_soc || "")}
            <label>Cloud mode
              <select data-key="cloud_mode">
                <option value="auto" ${c.cloud_mode === "auto" ? "selected" : ""}>auto</option>
                <option value="entity" ${c.cloud_mode === "entity" ? "selected" : ""}>entity</option>
                <option value="off" ${c.cloud_mode === "off" ? "selected" : ""}>off</option>
              </select>
            </label>
            ${this._field("pv_sky_state", "PV sky state entity", c.pv_sky_state || "")}
            <div class="vnp-note">Szerokość karty ustawiasz w układzie dashboardu. Ta karta zgłasza domyślnie pełną szerokość w Sections view.</div>
          </div>
        `;
        this.querySelectorAll("input, select").forEach((el) => {
          el.addEventListener("change", () => this._valueChanged(el.dataset.key, el.value));
        });
      }

      _field(key, label, value) {
        return `<label>${label}<input data-key="${key}" value="${String(value).replace(/"/g, "&quot;")}"></label>`;
      }

      _valueChanged(key, value) {
        const newConfig = { ...(this._config || {}) };
        if (value === "") delete newConfig[key];
        else newConfig[key] = value;
        this._config = newConfig;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
      }
    });
  }

  if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, VNPowerFlowCard);

  window.customCards = window.customCards || [];
  window.customCards.push({ type: CARD_TAG, name: "VN Power Flow Card", description: "Real-time power flow card for Home Assistant", preview: true });

  console.info(`%c VN Power Flow Card %c v${CARD_VERSION} `, "color: #ffb300; font-weight: 700;", "color: inherit;");
})();
