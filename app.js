const canvas = document.getElementById('trace-canvas');
const ctx = canvas.getContext('2d');
const vehicleCountEl = document.getElementById('vehicle-count');
const pointCountEl = document.getElementById('point-count');
const loadingOverlay = document.getElementById('loading-overlay');
const clearBtn = document.getElementById('clear-btn');
const fadeBtn = document.getElementById('toggle-fade');

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

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
resize();

function project(lat, lon) {
    const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * canvas.width;
    const y = (1 - (lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * canvas.height;
    return { x, y };
}

async function fetchVehicles() {
    try {
        const response = await fetch('https://svc.metrotransit.org/nextripv2/vehicles');
        const data = await response.json();
        const vehicleList = data.vehicles || data;

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
        if (!v.latitude || !v.longitude) return;

        const pos = project(v.latitude, v.longitude);
        const tripId = v.trip_id;
        const routeId = v.route_id;

        const baseColor = colorMap[routeId] || colorMap['DEFAULT'];

        if (vehicles.has(tripId)) {
            const lastPos = vehicles.get(tripId);
            
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
            ctx.strokeStyle = baseColor.replace(')', ', 0.3)').replace('rgb', 'rgba');
            if (!baseColor.includes('rgba')) {
                 // Convert hex to rgba for glow if needed, but these are simple hex
                 ctx.shadowBlur = 10;
                 ctx.shadowColor = baseColor;
            }
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
