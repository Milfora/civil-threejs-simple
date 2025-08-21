import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSurfaceMesh, heightAt } from './surface';
import { Alignment } from './alignment';
import { CrossSectionOverlay } from './crossSection';
import { SectionMarker } from './sectionMarker';
import { createRoadwayMesh, createRoadEdges, RoadTemplate, createRoadwayMeshFromTwoIPs, createRoadEdgesFromTwoIPs, createDaylightMeshFromTwoIPs } from './roadway';
import { ProfileOverlay } from './profile';

// Z-up world for all objects
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const app = document.getElementById('app') as HTMLDivElement;
if (!app) throw new Error('App container not found');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e23);

// Camera
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-30, -40, 28);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('canvas3d');
app.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; // snappier feel
controls.rotateSpeed = 1.1;
controls.zoomSpeed = 1.1;
controls.panSpeed = 1.0;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.target.set(0, 0, 0);

// Lights
const hemi = new THREE.HemisphereLight(0xdadada, 0x2b2f34, 0.65);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.55);
dir.position.set(-60, -40, 120);
scene.add(dir);

// Grid on XY plane (rotate default XZ grid to XY)
// Engineering-like muted grey grid on ground (XY plane)
const grid = new THREE.GridHelper(400, 80, 0x3c4148, 0x2a2f36);
grid.rotation.x = Math.PI / 2;
grid.position.set(0, 0, -0.001);
grid.renderOrder = 0;
scene.add(grid);

// Surface
const surface = createSurfaceMesh(200, 200, heightAt);
surface.renderOrder = 1;
scene.add(surface);

// Alignment
const alignment = new Alignment();
scene.add(alignment.object3d);

// Roadway visualization
let roadTemplate: RoadTemplate = {
	laneWidth: 0.5,
	shoulderWidth: 0.25,
	crossfallLane: -0.02,
	crossfallShoulder: -0.04
};
let daylightHtoV = 2; // 2H:1V by default
const initialRoadTemplate: RoadTemplate = { ...roadTemplate };
const initialDaylightHtoV = daylightHtoV;
// Use two-IP vertical profile (start/end from existing ground) for roadway modeling
let roadMesh = createRoadwayMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate);
scene.add(roadMesh);
let roadEdges = createRoadEdgesFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate);
scene.add(roadEdges);
let daylightMesh = createDaylightMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, daylightHtoV);
scene.add(daylightMesh);

function rebuildCorridor() {
	// Remove and dispose old objects
	scene.remove(roadMesh);
	scene.remove(roadEdges);
	scene.remove(daylightMesh);
	roadMesh.geometry.dispose();
	(roadMesh.material as THREE.Material).dispose();
	roadEdges.geometry.dispose();
	(roadEdges.material as THREE.Material).dispose();
	daylightMesh.geometry.dispose();
	(daylightMesh.material as THREE.Material).dispose();
	// Recreate with current parameters
	roadMesh = createRoadwayMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate);
	scene.add(roadMesh);
	roadEdges = createRoadEdgesFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate);
	scene.add(roadEdges);
	daylightMesh = createDaylightMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, daylightHtoV);
	scene.add(daylightMesh);
}

// Coordinate HUD (bottom-right)
const coordEl = document.getElementById('coord-overlay') as HTMLDivElement | null;
if (!coordEl) throw new Error('Coordinate overlay not found');

// Cross-section overlay
const overlay = new CrossSectionOverlay();
const marker = new SectionMarker();
scene.add(marker.line);
const toggleBtn = document.getElementById('btn-cross-section') as HTMLButtonElement;
toggleBtn.addEventListener('click', () => {
	overlay.setActive(!overlay.active);
	marker.setVisible(false);
});

// Profile overlay
const profileOverlay = new ProfileOverlay();
const btnProfile = document.getElementById('btn-profile') as HTMLButtonElement;
btnProfile.addEventListener('click', () => {
	profileOverlay.setActive(!profileOverlay.active);
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
	}
});

// Settings overlay
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const form = document.getElementById('settings-form') as HTMLFormElement;
const inLane = document.getElementById('laneWidth') as HTMLInputElement;
const inShoulder = document.getElementById('shoulderWidth') as HTMLInputElement;
const inCrossfallLane = document.getElementById('crossfallLane') as HTMLInputElement;
const inCrossfallShoulder = document.getElementById('crossfallShoulder') as HTMLInputElement;
const inDaylight = document.getElementById('daylightHtoV') as HTMLInputElement;
const btnApply = document.getElementById('btn-settings-apply') as HTMLButtonElement;
const btnReset = document.getElementById('btn-settings-reset') as HTMLButtonElement;
const closeSettings = settingsOverlay.querySelector('.overlay-close') as HTMLButtonElement | null;

function populateSettingsInputs() {
	inLane.value = String(roadTemplate.laneWidth);
	inShoulder.value = String(roadTemplate.shoulderWidth);
	inCrossfallLane.value = String(roadTemplate.crossfallLane);
	inCrossfallShoulder.value = String(roadTemplate.crossfallShoulder);
	inDaylight.value = String(daylightHtoV);
}

btnSettings.addEventListener('click', () => {
	populateSettingsInputs();
	settingsOverlay.classList.remove('hidden');
});
closeSettings?.addEventListener('mousedown', (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); });
closeSettings?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	settingsOverlay.classList.add('hidden');
});

btnApply.addEventListener('click', () => {
	const lane = Number.parseFloat(inLane.value);
	const shoulder = Number.parseFloat(inShoulder.value);
	const cLane = Number.parseFloat(inCrossfallLane.value);
	const cShoulder = Number.parseFloat(inCrossfallShoulder.value);
	const dHtoV = Number.parseFloat(inDaylight.value);
	if (Number.isFinite(lane) && lane >= 0) roadTemplate.laneWidth = lane;
	if (Number.isFinite(shoulder) && shoulder >= 0) roadTemplate.shoulderWidth = shoulder;
	if (Number.isFinite(cLane)) roadTemplate.crossfallLane = cLane;
	if (Number.isFinite(cShoulder)) roadTemplate.crossfallShoulder = cShoulder;
	if (Number.isFinite(dHtoV) && dHtoV > 0) daylightHtoV = dHtoV;
	rebuildCorridor();
});

btnReset.addEventListener('click', () => {
	roadTemplate = { ...initialRoadTemplate };
	daylightHtoV = initialDaylightHtoV;
	populateSettingsInputs();
	rebuildCorridor();
});

// Mouse → XY-plane world position
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const planeXY = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0

renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	if (!overlay.active) { marker.setVisible(false); return; }

	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const hit = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planeXY, hit)) return;

	// Closest on alignment (in XY)
	const closest = alignment.closestPointTo(hit.x, hit.y);

	// Only show when near alignment
	const nearThreshold = 2.8; // world units
	if (closest.distance > nearThreshold) { marker.setVisible(false); return; }

	// Perpendicular (to tangent) direction in XY
	const perp = new THREE.Vector2(-closest.tangent.y, closest.tangent.x).normalize();

	// Compute and draw section
	const halfWidth = 10;
	const samples = 240;

	// Compute two-IP profile center elevation at this chainage
	const centerline = alignment.getPoints();
	let sAccum = 0;
	for (let i = 1; i < centerline.length; i++) {
		const segLen = centerline[i].distanceTo(centerline[i - 1]);
		if (closest.segmentIndex < i) break;
		sAccum += segLen;
	}
	const segA = centerline[closest.segmentIndex];
	const segB = centerline[closest.segmentIndex + 1] ?? segA;
	const segLen = segB.distanceTo(segA) || 1;
	const segT = THREE.MathUtils.clamp(segLen > 0 ? closest.point.distanceTo(segA) / segLen : 0, 0, 1);
	const sHere = sAccum + segLen * segT;
	const totalLen = centerline.reduce((acc, p, idx) => idx === 0 ? 0 : acc + p.distanceTo(centerline[idx - 1]), 0);
	const zStart = heightAt(centerline[0].x, centerline[0].y);
	const zEnd = heightAt(centerline[centerline.length - 1].x, centerline[centerline.length - 1].y);
	const tGrade = totalLen > 0 ? sHere / totalLen : 0;
	const profileCenterZ = THREE.MathUtils.lerp(zStart, zEnd, tGrade);

	const section = overlay.computeSection(closest.point, perp, halfWidth, samples, heightAt, profileCenterZ, roadTemplate, daylightHtoV);
	overlay.draw(section, `s ≈ ${closest.chainage.toFixed(1)} m  (⊥ span ${2 * halfWidth} m)`, roadTemplate);

	// Update profile overlay marker if visible
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(centerline, heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`, sHere);
	}

	// Update visual bar marker at section location
	marker.update(closest.point, perp, halfWidth, heightAt);
	marker.setVisible(true);
});

// Coordinate HUD updater: show E/N/Z when hovering surface or road/daylight
raycaster.params.Line = { ...raycaster.params.Line, threshold: 0.3 };
renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const intersections = raycaster.intersectObjects([daylightMesh, roadMesh, surface], true);
	const hit = intersections[0];
	if (hit && hit.point) {
		const p = hit.point;
		coordEl.textContent = `E: ${p.x.toFixed(2)}  N: ${p.y.toFixed(2)}  Z: ${p.z.toFixed(2)}`;
	} else {
		coordEl.textContent = 'E: —  N: —  Z: —';
	}
});

// Resize
window.addEventListener('resize', () => {
	const w = window.innerWidth, h = window.innerHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
});

// Animate
function animate() {
	requestAnimationFrame(animate);
	controls.update();
	renderer.render(scene, camera);
}
animate();


