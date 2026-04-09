const canvas = document.getElementById('trace-canvas');
const ctx = canvas.getContext('2d');
const vehicleCountEl = document.getElementById('vehicle-count');
const pointCountEl = document.getElementById('point-count');
const loadingOverlay = document.getElementById('loading-overlay');
const clearBtn = document.getElementById('clear-btn');
const fadeBtn = document.getElementById('toggle-fade');

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

const gtfsRealtimeRoot = protobuf.parse(GTFS_REALTIME_PROTO).root;
const FeedMessage = gtfsRealtimeRoot.lookupType('transit_realtime.FeedMessage');

// State
let vehicles = new Map(); // Store vehicle history
let totalPoints = 0;
let isFirstLoad = true;
let shouldFade = false;
let colorMap = {
    '901': '#00fff2', // Blue Line
    '902': '#00ff00', // Green Line
    '903': '#ff00ff', // Red Line
    '904': '#ff4d00', // Orange Line
    '906': '#ffff00', // Gold Line (future/planned)
    'DEFAULT': 'rgba(255, 255, 255, 0.4)'
};

// Bounds for MSP Area - Tightened for better display
const BOUNDS = {
    minLat: 44.82,
    maxLat: 45.08,
    minLon: -93.40,
    maxLon: -92.95
};

const MAX_JUMP_DISTANCE = 250;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
resize();

function project(lat, lon) {
    const lonSpan = BOUNDS.maxLon - BOUNDS.minLon;
    const latSpan = BOUNDS.maxLat - BOUNDS.minLat;
    const scale = Math.min(canvas.width / lonSpan, canvas.height / latSpan);
    const mapWidth = lonSpan * scale;
    const mapHeight = latSpan * scale;
    const offsetX = (canvas.width - mapWidth) / 2;
    const offsetY = (canvas.height - mapHeight) / 2;
    const x = offsetX + ((lon - BOUNDS.minLon) * scale);
    const y = offsetY + ((BOUNDS.maxLat - lat) * scale);
    return { x, y };
}

function isReasonableJump(lastPos, nextPos) {
    const deltaX = nextPos.x - lastPos.x;
    const deltaY = nextPos.y - lastPos.y;
    return Math.hypot(deltaX, deltaY) <= MAX_JUMP_DISTANCE;
}

function toRgba(color, alpha) {
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const expanded = hex.length === 3
            ? hex.split('').map(char => char + char).join('')
            : hex;
        const red = parseInt(expanded.slice(0, 2), 16);
        const green = parseInt(expanded.slice(2, 4), 16);
        const blue = parseInt(expanded.slice(4, 6), 16);
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

async function fetchVehicles() {
    try {
        const response = await fetch(FEED_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while fetching vehicle feed`);
        }

        const buffer = await response.arrayBuffer();
        const feed = FeedMessage.decode(new Uint8Array(buffer));
        const vehicleList = (feed.entity || [])
            .filter(entity => entity.vehicle && entity.vehicle.position)
            .map(entity => ({
                vehicle_id: entity.vehicle.vehicle && entity.vehicle.vehicle.id ? entity.vehicle.vehicle.id : entity.id,
                trip_id: entity.vehicle.trip && entity.vehicle.trip.tripId ? entity.vehicle.trip.tripId : entity.id,
                route_id: entity.vehicle.trip && entity.vehicle.trip.routeId ? entity.vehicle.trip.routeId : 'DEFAULT',
                latitude: entity.vehicle.position.latitude,
                longitude: entity.vehicle.position.longitude,
            }));

        if (isFirstLoad) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => loadingOverlay.style.display = 'none', 1000);
            isFirstLoad = false;
        }

        updateArt(vehicleList);
        vehicleCountEl.textContent = vehicleList.length;
    } catch (error) {
        console.error('Error fetching vehicle data:', error);
    }
}

function updateArt(vehicleList) {
    if (shouldFade) {
        ctx.fillStyle = 'rgba(5, 5, 5, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    vehicleList.forEach(v => {
        if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) return;

        const pos = project(v.latitude, v.longitude);
        const tripId = v.vehicle_id || v.trip_id;
        const routeId = v.route_id;

        const baseColor = colorMap[routeId] || colorMap['DEFAULT'];

        if (vehicles.has(tripId)) {
            const lastPos = vehicles.get(tripId);

            if (!isReasonableJump(lastPos, pos)) {
                vehicles.set(tripId, pos);
                return;
            }
            
            // Core Line
            ctx.beginPath();
            ctx.moveTo(lastPos.x, lastPos.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Outer Glow
            ctx.beginPath();
            ctx.moveTo(lastPos.x, lastPos.y);
            ctx.lineTo(pos.x, pos.y);
              ctx.strokeStyle = toRgba(baseColor, 0.3);
              ctx.shadowBlur = 10;
              ctx.shadowColor = baseColor;
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.shadowBlur = 0; // Reset shadow for efficiency
        } else {
            // New vehicle point
            ctx.fillStyle = baseColor;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        vehicles.set(tripId, pos);
        totalPoints++;
    });

    pointCountEl.textContent = totalPoints.toLocaleString();
}

// Controls
clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    totalPoints = 0;
    pointCountEl.textContent = '0';
});

fadeBtn.addEventListener('click', () => {
    shouldFade = !shouldFade;
    fadeBtn.textContent = shouldFade ? 'Disable Persistence' : 'Enable Persistence';
});

// Animation Loop (not strictly needed for static trails, but good for future glows)
function animate() {
    requestAnimationFrame(animate);
}

// Initial fetch and start interval
fetchVehicles();
setInterval(fetchVehicles, 15000); // Fetch every 15 seconds
animate();
