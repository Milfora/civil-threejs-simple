import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSurfaceMesh, heightAt } from './surface';
import { Alignment } from './alignment';
import { theme3D } from './theme';
import { CrossSectionOverlay } from './crossSection';
import { SectionMarker } from './sectionMarker';
import { createRoadwayMesh, createRoadEdges, RoadTemplate, createRoadwayMeshFromTwoIPs, createRoadEdgesFromTwoIPs, createDaylightMeshFromTwoIPs, createCorridorFromTwoIPs } from './roadway';
import { ProfileOverlay } from './profile';

// Z-up world for all objects
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const app = document.getElementById('app') as HTMLDivElement;
if (!app) throw new Error('App container not found');

const scene = new THREE.Scene();
scene.background = new THREE.Color(theme3D.background);

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
const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd8dc, 0.65);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.55);
dir.position.set(-60, -40, 120);
scene.add(dir);

// Grid on XY plane (rotate default XZ grid to XY)
// Engineering-like muted grey grid on ground (XY plane)
const grid = new THREE.GridHelper(400, 80, theme3D.gridMajor, theme3D.gridMinor);
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

// IP handles (draggable)
const ipHandleGroup = new THREE.Group();
ipHandleGroup.renderOrder = 4;
scene.add(ipHandleGroup);
let ipHandleMeshes: THREE.Mesh[] = [];
const ipHandleRadius = 0.3;
const ipHandleGeom = new THREE.SphereGeometry(ipHandleRadius, 16, 12);
const ipMatEnd = new THREE.MeshBasicMaterial({ color: theme3D.ipEnd });
const ipMatInterior = new THREE.MeshBasicMaterial({ color: theme3D.ipInterior });

function refreshIPHandles() {
	const ips = alignment.getIPs();
	// Recreate meshes if count mismatches
	if (ipHandleMeshes.length !== ips.length) {
		for (const m of ipHandleMeshes) {
			ipHandleGroup.remove(m);
			m.geometry.dispose();
			(m.material as THREE.Material).dispose();
		}
		ipHandleMeshes = [];
		for (let i = 0; i < ips.length; i++) {
			const isEnd = i === 0 || i === ips.length - 1;
			const mat = (isEnd ? ipMatEnd : ipMatInterior).clone();
			const mesh = new THREE.Mesh(ipHandleGeom.clone(), mat);
			(mesh as any).userData = { index: i };
			mesh.renderOrder = 5;
			ipHandleGroup.add(mesh);
			ipHandleMeshes.push(mesh);
		}
	}
	for (let i = 0; i < ips.length; i++) {
		const p = ips[i];
		const mesh = ipHandleMeshes[i];
		if (!mesh) continue;
		mesh.position.set(p.x, p.y, 0);
		const isEnd = i === 0 || i === ips.length - 1;
		const mat = mesh.material as THREE.MeshBasicMaterial;
		mat.color.set(isEnd ? 0xf2994a : 0x56ccf2);
	}
}

// Roadway visualization
let roadTemplate: RoadTemplate = {
	laneWidth: 0.5,
	crossfallLane: -0.03,
	pavementThickness: 0.3,
	kerbWidth: 0.25,
	kerbHeight: 0.12,
	footpathWidth: 0.5,
	footpathThickness: 0.05,
	crossfallFootpath: -0.02
};
let daylightHtoV = 2; // 2H:1V by default
const initialRoadTemplate: RoadTemplate = { ...roadTemplate };
const initialDaylightHtoV = daylightHtoV;
// Use two-IP vertical profile (start/end from existing ground) for roadway modeling
let designStartZOverride: number | undefined = undefined;
let designEndZOverride: number | undefined = undefined;
let corridorGroup = createCorridorFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, designStartZOverride, designEndZOverride, []);
scene.add(corridorGroup);
let daylightMesh = createDaylightMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, daylightHtoV, designStartZOverride, designEndZOverride, []);
scene.add(daylightMesh);
refreshIPHandles();

// Floating popup for editing alignment fillet radius (per-corner)
let radiusPopupEl: HTMLDivElement | null = null;
let radiusPopupTargetCorner: number | null = null;
function closeRadiusPopup() {
    if (!radiusPopupEl) return;
    document.body.removeChild(radiusPopupEl);
    radiusPopupEl = null;
    controls.enabled = true;
    radiusPopupTargetCorner = null;
}
function openRadiusPopup(clientX: number, clientY: number, initialRadius: number, cornerIndex: number | null) {
    closeRadiusPopup();
    controls.enabled = false;
    radiusPopupTargetCorner = cornerIndex;
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.left = `${clientX}px`;
    div.style.top = `${clientY}px`;
    div.style.transform = 'translate(8px, 8px)';
    div.style.background = '#ffffff';
    div.style.color = '#3d4451';
    div.style.border = '1px solid #d9dee5';
    div.style.borderRadius = '4px';
    div.style.padding = '6px 8px';
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    div.style.zIndex = '10000';
    div.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
    div.style.fontSize = '12px';

    const label = document.createElement('div');
    label.textContent = 'Curve radius';
    label.style.marginBottom = '4px';
    label.style.opacity = '0.9';
    div.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.min = '0';
    input.value = String(initialRadius);
    input.style.width = '120px';
    input.style.padding = '4px 6px';
    input.style.background = '#f7f9fb';
    input.style.color = '#2f3542';
    input.style.border = '1px solid #cfd6df';
    input.style.borderRadius = '3px';
    input.style.outline = 'none';
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeRadiusPopup();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const v = Number.parseFloat(input.value);
            if (Number.isFinite(v) && v > 0) {
                if (radiusPopupTargetCorner !== null) {
                    alignment.setCornerRadius(radiusPopupTargetCorner, v);
                } else {
                    alignment.setDefaultRadius(v);
                }
                rebuildCorridor();
                // refresh profile overlay if visible
                if (profileOverlay.active) {
                    const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
                    profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
                }
                updateVolumesHUD();
            }
            closeRadiusPopup();
        }
    });
    div.appendChild(input);

    const hint = document.createElement('div');
    hint.textContent = 'Enter to confirm, Esc to cancel';
    hint.style.marginTop = '4px';
    hint.style.opacity = '0.6';
    div.appendChild(hint);

    document.body.appendChild(div);
    radiusPopupEl = div;
    setTimeout(() => input.focus({ preventScroll: true }), 0);
}

// Load road template JSON (editable) and rebuild
async function loadRoadTemplateFromJSON(url: string) {
	try {
		const res = await fetch(url, { cache: 'no-cache' });
		if (!res.ok) throw new Error(`Failed to fetch template: ${res.status}`);
		const json = await res.json();
		// Map JSON to internal template type; allow both flat and componentized
		const tpl: RoadTemplate = {
			laneWidth: Number(json.laneWidth) ?? roadTemplate.laneWidth,
			crossfallLane: Number(json.crossfallLane) ?? roadTemplate.crossfallLane,
			pavementThickness: json.components?.pavement?.thickness ?? json.pavementThickness ?? roadTemplate.pavementThickness,
			kerbWidth: json.components?.kerb?.width ?? json.kerbWidth ?? roadTemplate.kerbWidth,
			kerbHeight: json.components?.kerb?.height ?? json.kerbHeight ?? roadTemplate.kerbHeight,
			footpathWidth: json.components?.footpath?.width ?? json.footpathWidth ?? roadTemplate.footpathWidth,
			footpathThickness: json.components?.footpath?.thickness ?? json.footpathThickness ?? roadTemplate.footpathThickness,
			crossfallFootpath: json.components?.footpath?.crossfall ?? json.crossfallFootpath ?? roadTemplate.crossfallFootpath,
			components: json.components
		};
		roadTemplate = tpl;
		const dl = json.components?.daylight?.slopeHtoV;
		if (typeof dl === 'number' && dl > 0) daylightHtoV = dl;
		rebuildCorridor();
		populateSettingsInputs();
	} catch (err) {
		console.warn('Template JSON load failed:', err);
	}
}

// Kick off load from public folder; user can edit and reload the page
loadRoadTemplateFromJSON('/templates/default-road-template.json');

function rebuildCorridor() {
	// Remove and dispose old objects
	scene.remove(corridorGroup);
	const disposeNode = (obj: THREE.Object3D) => {
		obj.traverse((child: any) => {
			if ((child as THREE.Mesh).geometry) {
				(child as THREE.Mesh).geometry.dispose();
			}
			if ((child as THREE.Mesh).material) {
				const mat = (child as THREE.Mesh).material as any;
				if (Array.isArray(mat)) mat.forEach((m: THREE.Material) => m.dispose());
				else (mat as THREE.Material).dispose();
			}
		});
	};
	disposeNode(corridorGroup);
	scene.remove(daylightMesh);
	daylightMesh.geometry.dispose();
	(daylightMesh.material as THREE.Material).dispose();
	// Recreate with current parameters
	corridorGroup = createCorridorFromTwoIPs(
		alignment.getPoints(),
		heightAt,
		roadTemplate,
		designStartZOverride,
		designEndZOverride,
		profileOverlay.getGradeProfile()
	);
	scene.add(corridorGroup);
	daylightMesh = createDaylightMeshFromTwoIPs(
		alignment.getPoints(),
		heightAt,
		roadTemplate,
		// Prefer daylight slope from template components if present
		(roadTemplate.components?.daylight?.slopeHtoV ?? daylightHtoV),
		designStartZOverride,
		designEndZOverride,
		profileOverlay.getGradeProfile()
	);
	scene.add(daylightMesh);
	updateVolumesHUD();
}

// Coordinate HUD (bottom-right)
const coordEl = document.getElementById('coord-overlay') as HTMLDivElement | null;
if (!coordEl) throw new Error('Coordinate overlay not found');
const volumeEl = document.getElementById('volume-overlay') as HTMLDivElement | null;
if (!volumeEl) throw new Error('Volume overlay not found');

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
// When user drags start/end handles in profile, override two-IP grade and rebuild
profileOverlay.onGradeChange = ({ startZ, endZ }) => {
    if (startZ !== undefined) designStartZOverride = startZ;
    if (endZ !== undefined) designEndZOverride = endZ;
    rebuildCorridor();
    // refresh profile overlay with current overrides
    if (profileOverlay.active) {
        const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
        profileOverlay.setDesignOverrides(designStartZOverride, designEndZOverride);
        profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
    }
};
const btnProfile = document.getElementById('btn-profile') as HTMLButtonElement;
btnProfile.addEventListener('click', () => {
	profileOverlay.setActive(!profileOverlay.active);
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
	}
});

// Alignment creation command (click to add IPs; right-click/Enter to finish; Escape to cancel)
const btnAlign = document.getElementById('btn-align') as HTMLButtonElement | null;
let isCreatingAlignment = false;
let createdIPs: THREE.Vector2[] = [];
let previewLine: THREE.Line | null = null;
let savedAlignmentPoints: THREE.Vector2[] | null = null;
let savedAlignmentIPs: THREE.Vector2[] | null = null;
const defaultFilletRadius = 10; // world units

function setAlignmentCreateMode(on: boolean) {
	isCreatingAlignment = on;
	controls.enabled = !on;
	ipHandleGroup.visible = !on;
	if (!on) {
		if (previewLine) {
			scene.remove(previewLine);
			previewLine.geometry.dispose();
			(previewLine.material as THREE.Material).dispose();
			previewLine = null;
		}
		createdIPs = [];
	}
}

function ensurePreviewLine() {
	if (previewLine) return;
	const mat = new THREE.LineBasicMaterial({ color: 0x56ccf2, linewidth: 5 });
	const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
	previewLine = new THREE.Line(geom, mat);
	previewLine.renderOrder = 3;
	scene.add(previewLine);
}

function updatePreview(currentMouse?: THREE.Vector3) {
	if (!previewLine) return;
	const pts: THREE.Vector3[] = [];
	for (const p of createdIPs) pts.push(new THREE.Vector3(p.x, p.y, 0));
	if (currentMouse) pts.push(new THREE.Vector3(currentMouse.x, currentMouse.y, 0));
	if (pts.length < 2) {
		pts.push(pts[0] ?? new THREE.Vector3());
	}
	const geom = new THREE.BufferGeometry().setFromPoints(pts);
	previewLine.geometry.dispose();
	(previewLine as any).geometry = geom;
}

function finishAlignmentCreation(commit: boolean) {
	if (commit && createdIPs.length >= 2) {
		alignment.buildFromIPs(createdIPs, defaultFilletRadius, 1.0, 1.0);
		rebuildCorridor();
		refreshIPHandles();
		// refresh profile overlay if visible
		if (profileOverlay.active) {
			const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
			profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
		}
	} else if (!commit) {
		// restore previous alignment
		if (savedAlignmentIPs) {
			alignment.setIPs(savedAlignmentIPs);
		} else if (savedAlignmentPoints) {
			alignment.setPolyline(savedAlignmentPoints);
		}
		rebuildCorridor();
		refreshIPHandles();
	}
	savedAlignmentPoints = null;
	savedAlignmentIPs = null;
	setAlignmentCreateMode(false);
}

btnAlign?.addEventListener('click', () => {
	if (isCreatingAlignment) {
		finishAlignmentCreation(false);
		return;
	}
	// save current alignment and start new creation
	savedAlignmentPoints = alignment.getPoints().map(p => p.clone());
	savedAlignmentIPs = alignment.getIPs().map(p => p.clone());
	createdIPs = [];
	ensurePreviewLine();
	updatePreview();
	setAlignmentCreateMode(true);
});

// Settings overlay
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const form = document.getElementById('settings-form') as HTMLFormElement;
const inLane = document.getElementById('laneWidth') as HTMLInputElement;
const inCrossfallLane = document.getElementById('crossfallLane') as HTMLInputElement;
const inDaylight = document.getElementById('daylightHtoV') as HTMLInputElement;
const btnApply = document.getElementById('btn-settings-apply') as HTMLButtonElement;
const btnReset = document.getElementById('btn-settings-reset') as HTMLButtonElement;
const closeSettings = settingsOverlay.querySelector('.overlay-close') as HTMLButtonElement | null;

function populateSettingsInputs() {
	inLane.value = String(roadTemplate.laneWidth);
	inCrossfallLane.value = String(roadTemplate.crossfallLane);
	inDaylight.value = String(roadTemplate.components?.daylight?.slopeHtoV ?? daylightHtoV);
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
	const cLane = Number.parseFloat(inCrossfallLane.value);
	const dHtoV = Number.parseFloat(inDaylight.value);
	if (Number.isFinite(lane) && lane >= 0) roadTemplate.laneWidth = lane;
	if (Number.isFinite(cLane)) roadTemplate.crossfallLane = cLane;
	if (Number.isFinite(dHtoV) && dHtoV > 0) {
		daylightHtoV = dHtoV;
		if (!roadTemplate.components) roadTemplate.components = {};
		if (!roadTemplate.components.daylight) roadTemplate.components.daylight = {};
		roadTemplate.components.daylight.slopeHtoV = dHtoV;
	}
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

// Dragging state for IPs
let draggingIPIndex: number | null = null;

renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const hit = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planeXY, hit)) return;

	// Update alignment preview in creation mode regardless of overlay state
	if (isCreatingAlignment) {
		ensurePreviewLine();
		updatePreview(hit);
	}

	if (!overlay.active) { marker.setVisible(false); return; }

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

// Start dragging an IP handle
renderer.domElement.addEventListener('mousedown', (ev: MouseEvent) => {
	if (isCreatingAlignment) return;
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const hits = raycaster.intersectObjects(ipHandleGroup.children, true);
	if (hits.length > 0) {
		const obj = hits[0].object as THREE.Mesh;
		const idx = (obj as any).userData?.index as number | undefined;
		if (typeof idx === 'number') {
			draggingIPIndex = idx;
			controls.enabled = false;
			ev.preventDefault();
			ev.stopPropagation();
		}
	}
});

// Update drag
renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	if (draggingIPIndex === null) return;
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const hit = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planeXY, hit)) return;
	alignment.moveIP(draggingIPIndex, new THREE.Vector2(hit.x, hit.y));
	refreshIPHandles();
	rebuildCorridor();
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
	}
});

function endDrag() {
	if (draggingIPIndex === null) return;
	draggingIPIndex = null;
	controls.enabled = true;
}

renderer.domElement.addEventListener('mouseup', () => endDrag());
renderer.domElement.addEventListener('mouseleave', () => endDrag());

// Clicks for alignment creation
renderer.domElement.addEventListener('mousedown', (ev: MouseEvent) => {
	if (!isCreatingAlignment) return;
	// Left click to add IP; right click to finish
	if (ev.button === 0) {
		mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		const hit = new THREE.Vector3();
		if (raycaster.ray.intersectPlane(planeXY, hit)) {
			createdIPs.push(new THREE.Vector2(hit.x, hit.y));
			ensurePreviewLine();
			updatePreview(hit);
		}
		ev.preventDefault();
		ev.stopPropagation();
	} else if (ev.button === 2) {
		finishAlignmentCreation(true);
		ev.preventDefault();
		ev.stopPropagation();
	}
});

// Prevent context menu during creation
renderer.domElement.addEventListener('contextmenu', (ev: MouseEvent) => {
	// If not creating, allow context menu only if not near alignment; otherwise we will show radius popup
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const hit = new THREE.Vector3();
	if (raycaster.ray.intersectPlane(planeXY, hit)) {
		const closest = alignment.closestPointTo(hit.x, hit.y);
		const nearThreshold = 2.0;
		if (closest.distance <= nearThreshold && !isCreatingAlignment) {
			// Find nearest interior corner (IP index 1..n-2)
			const cornerIndex = alignment.getNearestCornerIndexTo(hit.x, hit.y);
			if (cornerIndex !== null) {
				const ips = alignment.getIPs();
				const cornerPos = ips[cornerIndex];
				const distToCorner = Math.hypot(cornerPos.x - hit.x, cornerPos.y - hit.y);
				const cornerThreshold = 2.0;
				if (distToCorner <= cornerThreshold) {
					// Open popup to edit only this corner's radius
					ev.preventDefault();
					ev.stopPropagation();
					const initial = alignment.getCornerRadius(cornerIndex) ?? alignment.getDefaultRadius();
					openRadiusPopup(ev.clientX, ev.clientY, initial, cornerIndex);
					return false as unknown as void;
				}
			}
		}
	}
	if (isCreatingAlignment) {
		ev.preventDefault();
		return false as unknown as void;
	}
});

// Keyboard: Enter to finish, Escape to cancel
window.addEventListener('keydown', (ev: KeyboardEvent) => {
	if (radiusPopupEl) {
		if (ev.key === 'Escape') { ev.preventDefault(); closeRadiusPopup(); }
		return;
	}
	if (!isCreatingAlignment) return;
	if (ev.key === 'Enter') {
		finishAlignmentCreation(true);
		ev.preventDefault();
	} else if (ev.key === 'Escape') {
		finishAlignmentCreation(false);
		ev.preventDefault();
	}
});

// Coordinate HUD updater: show E/N/Z when hovering surface or road/daylight
raycaster.params.Line = { ...raycaster.params.Line, threshold: 0.3 };
renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const intersections = raycaster.intersectObjects([daylightMesh, corridorGroup, surface], true);
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
// === End-Area Volume Computation (Two-IP roadway vs existing ground) ===
function computeCrossSectionAreaAt(pointOnCenter: THREE.Vector2, perpDir: THREE.Vector2, template: RoadTemplate, samples = 200): { cut: number; fill: number } {
	// Approximate area between design crossfall plane and existing ground along the normal within template half width
	const dir = perpDir.clone().normalize();
	const laneW = template.laneWidth;
	const half = laneW;
	const offsets: number[] = [];
	for (let i = 0; i < samples; i++) {
		const t = i / (samples - 1);
		offsets.push(-half + 2 * half * t);
	}
	// Compute center elevation from two-IP profile along alignment endpoints
	const pts = alignment.getPoints();
	const zStart = heightAt(pts[0].x, pts[0].y);
	const zEnd = heightAt(pts[pts.length - 1].x, pts[pts.length - 1].y);
	const closest = alignment.closestPointTo(pointOnCenter.x, pointOnCenter.y);
	const totalLen = pts.reduce((acc, p, idx) => idx === 0 ? 0 : acc + p.distanceTo(pts[idx - 1]), 0) || 1;
	const tGrade = THREE.MathUtils.clamp(closest.chainage / totalLen, 0, 1);
	const centerZ = THREE.MathUtils.lerp(zStart, zEnd, tGrade);
	const slopeAt = (offset: number) => (
		(Math.abs(offset) <= laneW ? template.crossfallLane : template.crossfallLane) * Math.sign(offset || 0)
	);
	let cut = 0, fill = 0;
	for (let i = 0; i < offsets.length - 1; i++) {
		const s0 = offsets[i];
		const s1 = offsets[i + 1];
		const oMid = 0.5 * (s0 + s1);
		const xMid = pointOnCenter.x + dir.x * oMid;
		const yMid = pointOnCenter.y + dir.y * oMid;
		const zSurf = heightAt(xMid, yMid);
		const zDesign = centerZ + slopeAt(oMid) * oMid;
		const dz = zDesign - zSurf;
		const stripWidth = (s1 - s0);
		const area = dz * stripWidth; // signed area slice (m^2)
		if (area > 0) fill += area; else cut += -area;
	}
	return { cut, fill };
}

function computeVolumesEndArea(): { cut: number; fill: number } {
	const pts = alignment.getPoints();
	if (pts.length < 2) return { cut: 0, fill: 0 };
	let totalCut = 0;
	let totalFill = 0;
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		const segLen = a.distanceTo(b);
		if (segLen <= 1e-6) continue;
		const tan = new THREE.Vector2().subVectors(b, a).normalize();
		const perp = new THREE.Vector2(-tan.y, tan.x).normalize();
		const areaA = computeCrossSectionAreaAt(a, perp, roadTemplate);
		const areaB = computeCrossSectionAreaAt(b, perp, roadTemplate);
		// Trapezoidal: V = L/2 * (A1 + A2)
		const cutVol = segLen * 0.5 * (areaA.cut + areaB.cut);
		const fillVol = segLen * 0.5 * (areaA.fill + areaB.fill);
		totalCut += cutVol;
		totalFill += fillVol;
	}
	return { cut: totalCut, fill: totalFill };
}

function updateVolumesHUD() {
	const v = computeVolumesEndArea();
	if (volumeEl) volumeEl.textContent = `Cut: ${v.cut.toFixed(1)} m³  Fill: ${v.fill.toFixed(1)} m³`;
}

// Initial compute
updateVolumesHUD();


