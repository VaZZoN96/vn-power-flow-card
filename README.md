# VN Power Flow Card

**Real-time power flow card for Home Assistant**

VN Power Flow Card is a custom Lovelace card for Home Assistant. It displays real-time power flow between solar PV, home consumption, battery and grid.

The card includes:

- animated power flow lines,
- animated sun,
- optional clouds and snow/blocked states,
- PV, home, grid and battery values,
- battery state of charge bar,
- configurable entity names,
- configurable sign convention for grid and battery power.

## Repository

```text
vn-power-flow-card
```

## Card type

```yaml
type: custom:vn-power-flow-card
```

## Installation with HACS

1. Open Home Assistant.
2. Go to HACS.
3. Open the three-dot menu.
4. Choose **Custom repositories**.
5. Paste the GitHub repository URL.
6. Select category/type: **Dashboard**.
7. Add the repository.
8. Install the card.
9. Refresh your browser cache.

## Manual installation

Copy this file:

```text
dist/vn-power-flow-card.js
```

to:

```text
/config/www/vn-power-flow-card.js
```

Then add it as a dashboard resource:

```yaml
url: /local/vn-power-flow-card.js
type: module
```

After that, use the card in your dashboard:

```yaml
type: custom:vn-power-flow-card
title: VN Power Flow
pv_power: sensor.pv_power
home_power: sensor.home_power
grid_power: sensor.grid_power
battery_power: sensor.battery_power
battery_soc: sensor.battery_soc
```

## Example configuration

```yaml
type: custom:vn-power-flow-card
title: VN Power Flow

pv_power: sensor.pv_power
home_power: sensor.home_power
grid_power: sensor.grid_power
battery_power: sensor.battery_power
battery_soc: sensor.battery_soc

sun_entity: sun.sun

cloud_mode: entity
pv_sky_state: sensor.pv_sky_state

grid_positive_direction: import
battery_positive_direction: discharge

threshold_w: 30
max_power_w: 10000

names:
  pv: PV
  home: Dom
  grid: Sieć
  battery: Bateria
  sun: Słońce
```

## Configuration options

| Option | Required | Default | Description |
|---|---:|---|---|
| `type` | yes | — | Must be `custom:vn-power-flow-card` |
| `title` | no | `VN Power Flow` | Card title |
| `pv_power` | yes | — | Current PV power entity |
| `home_power` | yes | — | Current home consumption entity |
| `grid_power` | yes | — | Current grid power entity |
| `battery_power` | no | — | Current battery power entity |
| `battery_soc` | no | — | Battery state of charge entity |
| `sun_entity` | no | `sun.sun` | Home Assistant sun entity |
| `cloud_mode` | no | `auto` | `auto`, `entity` or `off` |
| `pv_sky_state` | no | — | Entity with sky/PV state |
| `weather_entity` | no | — | Optional weather entity for auto mode |
| `grid_positive_direction` | no | `import` | `import` or `export` |
| `battery_positive_direction` | no | `discharge` | `discharge` or `charge` |
| `threshold_w` | no | `30` | Minimum power for animated flow |
| `max_power_w` | no | `10000` | Power used to scale line thickness |
| `names` | no | — | Custom display names |
| `show_clouds` | no | `true` | Show cloud animation |
| `show_snow` | no | `true` | Show snow/blocked animation |

## Power sign convention

Default grid convention:

```yaml
grid_positive_direction: import
```

This means:

```text
grid_power > 0 = import from grid
grid_power < 0 = export to grid
```

If your inverter reports it the opposite way, use:

```yaml
grid_positive_direction: export
```

Default battery convention:

```yaml
battery_positive_direction: discharge
```

This means:

```text
battery_power > 0 = battery discharging
battery_power < 0 = battery charging
```

If your inverter reports it the opposite way, use:

```yaml
battery_positive_direction: charge
```

## Sky states

The card can display clouds or snow/blocked states when `pv_sky_state` returns one of these values:

```text
night
low_sun
clear
partly_cloudy
cloudy
overcast
rainy
snow
snow_or_blocked
blocked
unknown
```

Recommended mode:

```yaml
cloud_mode: entity
pv_sky_state: sensor.pv_sky_state
```

This keeps the card simple. Home Assistant calculates the sky/PV state, and the card only displays it.

## Example PV sky state sensor

This is only a starting point. You should tune the thresholds for your own PV installation.

```yaml
template:
  - sensor:
      - name: "PV Sky State"
        unique_id: pv_sky_state
        state: >
          {% set pv = states('sensor.pv_power') | float(0) %}
          {% set expected = states('sensor.expected_clear_sky_pv_power') | float(0) %}
          {% set elevation = state_attr('sun.sun', 'elevation') | float(-90) %}
          {% set outdoor_temp = states('sensor.outdoor_temperature') | float(99) %}
          {% set ratio = (pv / expected * 100) if expected > 0 else 100 %}

          {% if states('sun.sun') == 'below_horizon' %}
            night
          {% elif elevation < 6 %}
            low_sun
          {% elif expected < 500 %}
            low_sun
          {% elif outdoor_temp < 2 and expected > 800 and ratio < 20 %}
            snow_or_blocked
          {% elif ratio > 80 %}
            clear
          {% elif ratio > 50 %}
            partly_cloudy
          {% elif ratio > 20 %}
            cloudy
          {% else %}
            unknown
          {% endif %}
```

## Suggested repository structure

```text
vn-power-flow-card/
├── dist/
│   └── vn-power-flow-card.js
├── examples/
│   └── dashboard.yaml
├── hacs.json
├── README.md
└── LICENSE
```

## Development notes

The card is currently a plain JavaScript Lovelace card without a build system.

Main file:

```text
dist/vn-power-flow-card.js
```

HACS metadata file:

```text
hacs.json
```

Example dashboard configuration:

```text
examples/dashboard.yaml
```

## License

MIT