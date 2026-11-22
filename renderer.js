// renderer.js -- draws Phosphor3D models, and loads them from JSON.
//
// The drawing loop mirrors Phosphor3D's own phosphor.js draw(): gather every
// model's projected polygons, depth-sort them far-to-near (painter's algorithm),
// skip back faces, then fill and stroke each one, with its subfaces on top.
//
// Coordinate frames: Model3D multiplies in `parent.localMatrix()` after its own
// transform, and anything with a localMatrix() method will do as a parent. So the
// game hangs each model on a "frame" object instead of moving the camera:
//   - cockpit frame: things fixed to the gunner's seat (bezel, cannon)
//   - world frame:   things out in space (ship hull, fighters), seen through the turret's aim
//
// Winding: in game coordinates (+x right, +y up, +z away from the viewer), a face is
// front-facing when its vertices run COUNTER-CLOCKWISE as seen by the viewer.
// Repeat the first vertex at the end to stroke the closing edge (see Phosphor3D README).
// To hide other edges, use the "faces2" form with "hiddenEdges" (see Phosphor3D face.js).

import { Model3D } from '../Phosphor3D/model3d.js';

/** A Model3D parent whose transform comes from a function, re-evaluated every frame. */
export function coordinateFrame(matrixFunction) {
	return { localMatrix: matrixFunction };
}

/** Fetch a Phosphor3D JSON model and hang it on `parent`. Resolves to the Model3D. */
export async function loadModel(path, parent) {
	return modelFromJSON(await loadJSON(path), parent);
}

/** Fetch a model's JSON once, to make several copies with modelFromJSON. */
export async function loadJSON(path) {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`Couldn't load ${path}: ${response.status}`);
	}
	return response.json();
}

/** A new Model3D from Phosphor3D JSON, hung on `parent`. */
export function modelFromJSON(json, parent) {
	const model = new Model3D();
	model.initFromJSONData(json);
	model.parent = parent;
	// Optional extra (not part of Phosphor3D's format): stroke width in pixels.
	model.lineWidth = json.lineWidth ?? 2;
	return model;
}

/** Draw a set of models with one shared depth sort. */
export function drawModels(ctx, camera, models) {
	const polygons = [];
	for (const model of models) {
		for (const polygon of model.transformedPolygons(camera)) {
			polygon.lineWidth = model.lineWidth;
			polygons.push(polygon);
		}
	}

	polygons.sort((a, b) => a.depth - b.depth);

	ctx.lineJoin = 'bevel';
	for (const polygon of polygons) {
		if (polygon.isBackface()) {
			continue;
		}
		drawPolygon(ctx, polygon, polygon.lineWidth);
		for (const subface of polygon.subfaces) {
			drawPolygon(ctx, subface, polygon.lineWidth);
		}
	}
}

function drawPolygon(ctx, polygon, lineWidth) {
	const vertices = polygon.vertices;
	ctx.beginPath();
	ctx.moveTo(vertices[0][0], vertices[0][1]);
	for (let v = 1; v < vertices.length; v++) {
		ctx.lineTo(vertices[v][0], vertices[v][1]);
	}
	if (polygon.fill) {
		ctx.fillStyle = polygon.fill;
		ctx.fill();
	}
	if (polygon.stroke) {
		if (polygon.hiddenEdges) {
			strokeVisibleEdges(ctx, vertices, polygon.hiddenEdges);
		}
		ctx.lineWidth = lineWidth;
		ctx.strokeStyle = polygon.stroke;
		ctx.stroke();
	}
}

// Replace the current path with the outline minus the hidden edges
// (edge i runs from vertices[i] to vertices[i + 1]; see Phosphor3D's Face.hiddenEdges).
function strokeVisibleEdges(ctx, vertices, hiddenEdges) {
	ctx.beginPath();
	let penDown = false;
	for (let v = 0; v < vertices.length - 1; v++) {
		if (hiddenEdges.includes(v)) {
			penDown = false;
			continue;
		}
		if (!penDown) {
			ctx.moveTo(vertices[v][0], vertices[v][1]);
			penDown = true;
		}
		ctx.lineTo(vertices[v + 1][0], vertices[v + 1][1]);
	}
}
