import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSurfaceMesh, heightAt } from './surface';
import { Alignment } from './alignment';
import { CrossSectionOverlay } from './crossSection';
import { SectionMarker } from './sectionMarker';
import { createRoadwayMesh, createRoadEdges, RoadTemplate } from './roadway';

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
const roadTemplate: RoadTemplate = {
	laneWidth: 3.5,
	shoulderWidth: 1.0,
	crossfallLane: -0.02,
	crossfallShoulder: -0.04
};
const roadMesh = createRoadwayMesh(alignment.getPoints(), heightAt, roadTemplate);
scene.add(roadMesh);
const roadEdges = createRoadEdges(alignment.getPoints(), roadTemplate);
scene.add(roadEdges);

// Cross-section overlay
const overlay = new CrossSectionOverlay();
const marker = new SectionMarker();
scene.add(marker.line);
const toggleBtn = document.getElementById('btn-cross-section') as HTMLButtonElement;
toggleBtn.addEventListener('click', () => {
	overlay.setActive(!overlay.active);
	marker.setVisible(false);
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
	const section = overlay.computeSection(closest.point, perp, halfWidth, samples, heightAt);
	overlay.draw(section, `s ≈ ${closest.chainage.toFixed(1)} m  (⊥ span ${2 * halfWidth} m)`);

	// Update visual bar marker at section location
	marker.update(closest.point, perp, halfWidth, heightAt);
	marker.setVisible(true);
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


