<script>
  import { onMount } from 'svelte';
  import protobuf from 'protobufjs';

  const FEED_URL = 'https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb';
  const GTFS_REALTIME_PROTO = `syntax = "proto2";

package transit_realtime;

message FeedMessage {
    required FeedHeader header = 1;
    repeated FeedEntity entity = 2;
}

message FeedHeader {
    enum Incrementality {
        FULL_DATASET = 0;
        DIFFERENTIAL = 1;
    }

    required string gtfs_realtime_version = 1;
    optional Incrementality incrementality = 2 [default = FULL_DATASET];
    optional uint64 timestamp = 3;
}

message FeedEntity {
    required string id = 1;
    optional bool is_deleted = 2 [default = false];
    optional TripUpdate trip_update = 3;
    optional VehiclePosition vehicle = 4;
    optional Alert alert = 5;
}

message TripDescriptor {
    optional string trip_id = 1;
    optional string route_id = 5;
}

message VehicleDescriptor {
    optional string id = 1;
    optional string label = 2;
    optional string license_plate = 3;
}

message Position {
    required float latitude = 1;
    required float longitude = 2;
    optional float bearing = 3;
    optional double odometer = 4;
    optional float speed = 5;
}

message VehiclePosition {
    optional TripDescriptor trip = 1;
    optional Position position = 2;
    optional uint32 current_stop_sequence = 3;
    optional VehicleStopStatus current_status = 4;
    optional uint64 timestamp = 5;
    optional uint32 congestion_level = 6;
    optional string stop_id = 7;
    optional VehicleDescriptor vehicle = 8;
    optional OccupancyStatus occupancy_status = 9;
    optional uint32 occupancy_percentage = 10;
}

message TripUpdate {}

message Alert {}

enum VehicleStopStatus {
    INCOMING_AT = 0;
    STOPPED_AT = 1;
    IN_TRANSIT_TO = 2;
}

enum OccupancyStatus {
    EMPTY = 0;
    MANY_SEATS_AVAILABLE = 1;
    FEW_SEATS_AVAILABLE = 2;
    STANDING_ROOM_ONLY = 3;
    CRUSHED_STANDING_ROOM_ONLY = 4;
    FULL = 5;
    NOT_ACCEPTING_PASSENGERS = 6;
}
`;

  let FeedMessage;

  function getFeedMessageType() {
    if (!FeedMessage) {
      const gtfsRealtimeRoot = protobuf.parse(GTFS_REALTIME_PROTO).root;
      FeedMessage = gtfsRealtimeRoot.lookupType('transit_realtime.FeedMessage');
    }

    return FeedMessage;
  }

  const colorMap = {
    901: '#00fff2',
    902: '#00ff00',
    903: '#ff00ff',
    904: '#ff4d00',
    906: '#ffff00',
    DEFAULT: 'rgba(255, 255, 255, 0.4)'
  };

  const BOUNDS = {
    minLat: 44.82,
    maxLat: 45.08,
    minLon: -93.4,
    maxLon: -92.95
  };

  const MAX_JUMP_DISTANCE = 250;

  let canvas;
  let ctx;
  let vehicles = new Map();
  let totalPoints = 0;
  let vehicleCount = 0;
  let shouldFade = false;
  let loadingVisible = true;
  let statusMessage = 'Fetching live transit data...';

  function resizeCanvas() {
    if (!canvas) {
      return;
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function project(lat, lon) {
    const lonSpan = BOUNDS.maxLon - BOUNDS.minLon;
    const latSpan = BOUNDS.maxLat - BOUNDS.minLat;
    const scale = Math.min(canvas.width / lonSpan, canvas.height / latSpan);
    const mapWidth = lonSpan * scale;
    const mapHeight = latSpan * scale;
    const offsetX = (canvas.width - mapWidth) / 2;
    const offsetY = (canvas.height - mapHeight) / 2;

    return {
      x: offsetX + (lon - BOUNDS.minLon) * scale,
      y: offsetY + (BOUNDS.maxLat - lat) * scale
    };
  }

  function isReasonableJump(lastPos, nextPos) {
    return Math.hypot(nextPos.x - lastPos.x, nextPos.y - lastPos.y) <= MAX_JUMP_DISTANCE;
  }

  function toRgba(color, alpha) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const expanded = hex.length === 3
        ? hex.split('').map((char) => char + char).join('')
        : hex;
      const red = Number.parseInt(expanded.slice(0, 2), 16);
      const green = Number.parseInt(expanded.slice(2, 4), 16);
      const blue = Number.parseInt(expanded.slice(4, 6), 16);
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    if (color.startsWith('rgba(')) {
      return color.replace(/rgba\(([^)]+),\s*[^)]+\)/, `rgba($1, ${alpha})`);
    }

    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
    }

    return color;
  }

  function clearCanvas() {
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    vehicles = new Map();
    totalPoints = 0;
  }

  function drawVehicles(vehicleList) {
    if (!ctx) {
      return;
    }

    if (shouldFade) {
      ctx.fillStyle = 'rgba(5, 5, 5, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (const vehicle of vehicleList) {
      if (!Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) {
        continue;
      }

      const pos = project(vehicle.latitude, vehicle.longitude);
      const trailKey = vehicle.vehicle_id || vehicle.id || vehicle.trip_id;
      const baseColor = colorMap[vehicle.route_id] || colorMap.DEFAULT;

      if (vehicles.has(trailKey)) {
        const lastPos = vehicles.get(trailKey);

        if (!isReasonableJump(lastPos, pos)) {
          vehicles.set(trailKey, pos);
          continue;
        }

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = toRgba(baseColor, 0.3);
        ctx.shadowBlur = 10;
        ctx.shadowColor = baseColor;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      vehicles.set(trailKey, pos);
      totalPoints += 1;
    }
  }

  async function fetchVehicles() {
    try {
      const response = await fetch(FEED_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching vehicle feed`);
      }

      const buffer = await response.arrayBuffer();
      const feedMessageType = getFeedMessageType();
      const feed = feedMessageType.decode(new Uint8Array(buffer));
      const vehicleList = (feed.entity ?? [])
        .filter((entity) => entity.vehicle && entity.vehicle.position)
        .map((entity) => ({
          id: entity.id,
          vehicle_id: entity.vehicle.vehicle && entity.vehicle.vehicle.id ? entity.vehicle.vehicle.id : null,
          trip_id: entity.vehicle.trip && entity.vehicle.trip.tripId ? entity.vehicle.trip.tripId : null,
          route_id: entity.vehicle.trip && entity.vehicle.trip.routeId ? entity.vehicle.trip.routeId : 'DEFAULT',
          latitude: entity.vehicle.position.latitude,
          longitude: entity.vehicle.position.longitude
        }));

      vehicleCount = vehicleList.length;
      drawVehicles(vehicleList);

      if (loadingVisible) {
        loadingVisible = false;
      }

      statusMessage = `Live feed updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      statusMessage = 'Unable to fetch live vehicle data.';
      console.error('Error fetching vehicle data:', error);
    }
  }

  function toggleFade() {
    shouldFade = !shouldFade;
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resizeCanvas();

    const handleResize = () => {
      resizeCanvas();
    };

    window.addEventListener('resize', handleResize);
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 15000);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(interval);
    };
  });
</script>

<svelte:head>
  <title>Metro Traces</title>
  <meta name="description" content="Live Metro Transit vehicle trails rendered from GTFS-realtime protobuf data." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

{#if loadingVisible}
  <div class="loading-overlay" aria-live="polite">
    <div class="loader"></div>
    <p class="subtitle">{statusMessage}</p>
  </div>
{/if}

<div class="app-shell">
  <canvas bind:this={canvas} aria-label="Metro Transit vehicle trails"></canvas>

  <div class="ui-layer">
    <header class="header">
      <p class="eyebrow">Twin Cities Real-time Transit Flow</p>
      <h1>Metro Traces</h1>
      <p class="subtitle">{statusMessage}</p>
    </header>

    <section class="controls">
      <div class="stat-grid">
        <div class="stat-item">
          <span class="stat-label">Active Vehicles</span>
          <span class="stat-value">{vehicleCount}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Data Points Captured</span>
          <span class="stat-value">{totalPoints.toLocaleString()}</span>
        </div>
      </div>

      <div class="legend">
        <div class="legend-item"><span class="color-dot" style="background:#00fff2"></span><span>METRO Blue Line</span></div>
        <div class="legend-item"><span class="color-dot" style="background:#00ff00"></span><span>METRO Green Line</span></div>
        <div class="legend-item"><span class="color-dot" style="background:#ff4d00"></span><span>METRO Orange Line</span></div>
        <div class="legend-item"><span class="color-dot" style="background:#ff00ff"></span><span>METRO Red Line</span></div>
        <div class="legend-item"><span class="color-dot" style="background:#ffffff"></span><span>Core Bus Routes</span></div>
      </div>

      <button class="btn" on:click={clearCanvas}>Clear Canvas</button>
      <button class="btn" aria-pressed={shouldFade} on:click={toggleFade}>
        {shouldFade ? 'Disable Persistence' : 'Enable Persistence'}
      </button>
    </section>
  </div>
</div>

<style>
  :global(html, body) {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at top, rgba(0, 255, 204, 0.08), transparent 42%),
      linear-gradient(180deg, #060708 0%, #030405 100%);
    color: #eef3f7;
    font-family: 'Inter', system-ui, sans-serif;
  }

  :global(body) {
    min-height: 100vh;
  }

  .app-shell {
    position: relative;
    width: 100vw;
    height: 100vh;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .ui-layer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: clamp(1rem, 2vw, 2rem);
    pointer-events: none;
    background:
      radial-gradient(circle at center, transparent 20%, rgba(0, 0, 0, 0.35) 100%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.18));
  }

  .header {
    pointer-events: auto;
    max-width: 26rem;
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.24em;
    color: rgba(238, 243, 247, 0.6);
  }

  h1 {
    margin: 0;
    font-size: clamp(2.4rem, 4vw, 4.5rem);
    line-height: 0.95;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 200;
    background: linear-gradient(90deg, #ffffff 0%, #87f5ff 52%, #ffe18d 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .subtitle {
    margin: 0.5rem 0 0;
    color: rgba(238, 243, 247, 0.7);
    font-size: 0.9rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .controls {
    pointer-events: auto;
    width: min(22rem, calc(100vw - 2rem));
    padding: 1.25rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    background: rgba(7, 10, 12, 0.76);
    backdrop-filter: blur(16px);
    box-shadow: 0 16px 50px rgba(0, 0, 0, 0.32);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
  }

  .stat-item {
    padding: 0.85rem;
    border-radius: 0.85rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .stat-label {
    display: block;
    margin-bottom: 0.3rem;
    color: rgba(238, 243, 247, 0.55);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .stat-value {
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .legend {
    margin-top: 1rem;
    display: grid;
    gap: 0.45rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    color: rgba(238, 243, 247, 0.84);
    font-size: 0.78rem;
  }

  .color-dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 999px;
    box-shadow: 0 0 10px currentColor;
    flex: 0 0 auto;
  }

  .btn {
    margin-top: 0.9rem;
    width: 100%;
    border: 1px solid rgba(0, 255, 204, 0.75);
    border-radius: 0.8rem;
    background: transparent;
    color: #8fffe9;
    padding: 0.85rem 1rem;
    cursor: pointer;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: transform 140ms ease, background 140ms ease, color 140ms ease, box-shadow 140ms ease;
  }

  .btn:hover {
    transform: translateY(-1px);
    background: rgba(0, 255, 204, 0.12);
    box-shadow: 0 0 16px rgba(0, 255, 204, 0.28);
  }

  .loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    gap: 1rem;
    background: rgba(0, 0, 0, 0.96);
  }

  .loader {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: #00ffcc;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 720px) {
    .ui-layer {
      justify-content: flex-end;
      gap: 1rem;
    }

    .controls {
      width: 100%;
    }

    .stat-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
