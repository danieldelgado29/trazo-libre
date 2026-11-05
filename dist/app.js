const get = id => document.getElementById(id);
const canvas = get('canvas');
const context = canvas.getContext('2d');
const paper = canvas.parentElement;
const storageKey = 'trazo-libre-dibujo-v1';
let saved;
try {
  saved = JSON.parse(localStorage.getItem(storageKey));
} catch {
  get('status').textContent = 'Guardado local no disponible';
}

const page = saved || { width: paper.clientWidth, height: paper.clientHeight, strokes: [] };
let strokes = page.strokes;
const undo = [];
const redo = [];
let active = null;
let fit = 1;
let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let hand = false;
let drag = null;
let pinch = null;
const touches = new Map();
const maxZoom = 6;
let tool = 'pen';
let color = get('color').value;

function segment(stroke, start, end) {
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.fillStyle = context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.beginPath();
  if (start.x === end.x && start.y === end.y) {
    context.arc(end.x, end.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
}

function render() {
  context.clearRect(0, 0, page.width, page.height);
  for (const stroke of active ? [...strokes, active.stroke] : strokes) {
    const points = stroke.points;
    segment(stroke, points[0], points[0]);
    for (let i = 1; i < points.length; i++) segment(stroke, points[i - 1], points[i]);
  }
}

function resize() {
  fit = Math.min(paper.clientWidth / page.width, paper.clientHeight / page.height);
  const ratio = Math.min(devicePixelRatio || 1, 3);
  canvas.style.width = page.width * fit + 'px';
  canvas.style.height = page.height * fit + 'px';
  canvas.width = Math.max(1, Math.round(page.width * fit * ratio));
  canvas.height = Math.max(1, Math.round(page.height * fit * ratio));
  context.setTransform(canvas.width / page.width, 0, 0, canvas.height / page.height, 0, 0);
  context.lineJoin = context.lineCap = 'round';
  applyView();
  render();
}

function applyView() {
  const limitX = Math.max(0, (page.width * fit * zoom - paper.clientWidth) / 2);
  const limitY = Math.max(0, (page.height * fit * zoom - paper.clientHeight) / 2);
  offsetX = Math.max(-limitX, Math.min(limitX, offsetX));
  offsetY = Math.max(-limitY, Math.min(limitY, offsetY));
  canvas.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${zoom})`;
  get('zoomReset').textContent = Math.round(zoom * 100) + ' %';
  get('zoomIn').disabled = zoom >= maxZoom;
  get('zoomOut').disabled = zoom <= 1;
}

function center() {
  const rect = paper.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function setZoom(next, from = center(), to = from) {
  const origin = center();
  const target = Math.max(1, Math.min(maxZoom, next));
  const factor = target / zoom;
  offsetX = to.x - origin.x - (from.x - origin.x - offsetX) * factor;
  offsetY = to.y - origin.y - (from.y - origin.y - offsetY) * factor;
  zoom = target;
  applyView();
}

function touchGeometry() {
  const [a, b] = touches.values();
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
    distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
  };
}

get('zoomIn').onclick = () => setZoom(zoom * 1.25);
get('zoomOut').onclick = () => setZoom(zoom / 1.25);
get('zoomReset').onclick = () => setZoom(1);

function setHand(enabled) {
  hand = enabled;
  get('pan').setAttribute('aria-pressed', String(hand));
  paper.classList.toggle('moving', hand);
}

get('pan').onclick = () => setHand(!hand);
paper.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setZoom(zoom * Math.exp(-event.deltaY * 0.012), { x: event.clientX, y: event.clientY });
}, { passive: false });

function updateButtons() {
  get('undo').disabled = undo.length === 0;
  get('redo').disabled = redo.length === 0;
  get('clear').disabled = strokes.length === 0;
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...page, strokes }));
    get('status').textContent = 'Guardado en este dispositivo';
  } catch {
    get('status').textContent = 'No se pudo guardar · exporta en PNG';
  }
  updateButtons();
}

function commit(next) {
  undo.push(strokes);
  if (undo.length > 80) undo.shift();
  strokes = next;
  redo.length = 0;
  save();
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * page.width / rect.width * 10) / 10,
    y: Math.round((event.clientY - rect.top) * page.height / rect.height * 10) / 10,
  };
}

paper.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, event);
    paper.setPointerCapture(event.pointerId);
    if (touches.size >= 2) {
      if (touches.size === 2) {
        active = null;
        drag = null;
        pinch = touchGeometry();
        render();
      }
      return;
    }
  }
  if (active || drag || event.target !== canvas) return;
  paper.setPointerCapture(event.pointerId);
  if (hand) {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    return;
  }
  const start = point(event);
  const width = Number(get('width').value);
  const stroke = { tool, color, width, points: [start] };
  active = { id: event.pointerId, stroke };
  segment(stroke, start, start);
});

function append(event) {
  const stroke = active.stroke;
  const next = point(event);
  const previous = stroke.points.at(-1);
  if (previous.x === next.x && previous.y === next.y) return;
  stroke.points.push(next);
  segment(stroke, previous, next);
}

paper.addEventListener('pointermove', event => {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, event);
    if (pinch && touches.size >= 2) {
      const next = touchGeometry();
      setZoom(zoom * next.distance / pinch.distance, pinch, next);
      pinch = next;
      return;
    }
  }
  if (drag?.id === event.pointerId) {
    offsetX += event.clientX - drag.x;
    offsetY += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    applyView();
    return;
  }
  if (active?.id !== event.pointerId) return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) append(sample);
});

function finish(event) {
  if (touches.delete(event.pointerId) && pinch) {
    pinch = touches.size >= 2 ? touchGeometry() : null;
  }
  if (drag?.id === event.pointerId) drag = null;
  if (active?.id !== event.pointerId) return;
  if (event.type === 'pointerup') append(event);
  const { stroke } = active;
  active = null;
  commit([...strokes, stroke]);
}

for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  paper.addEventListener(name, finish);
}

function selectTool(next) {
  tool = next;
  setHand(false);
  for (const name of ['pen', 'eraser']) get(name).setAttribute('aria-pressed', String(name === tool));
}

function selectColor(next) {
  color = next;
  get('color').value = next;
  for (const button of document.querySelectorAll('.swatch')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === color));
  }
  selectTool('pen');
}

for (const button of document.querySelectorAll('.swatch')) {
  button.onclick = () => selectColor(button.dataset.color);
}
get('color').oninput = event => selectColor(event.target.value);
get('pen').onclick = () => selectTool('pen');
get('eraser').onclick = () => selectTool('eraser');
get('width').oninput = event => { get('widthValue').value = event.target.value; };

function restore(from, to) {
  if (!from.length || active) return;
  to.push(strokes);
  strokes = from.pop();
  render();
  save();
}

get('undo').onclick = () => restore(undo, redo);
get('redo').onclick = () => restore(redo, undo);
get('clear').onclick = () => {
  if (active || !strokes.length) return;
  commit([]);
  render();
};
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) restore(redo, undo);
  else restore(undo, redo);
});

get('export').onclick = () => {
  const image = document.createElement('canvas');
  image.width = canvas.width;
  image.height = canvas.height;
  const output = image.getContext('2d');
  output.fillStyle = '#ffffff';
  output.fillRect(0, 0, image.width, image.height);
  output.drawImage(canvas, 0, 0);
  image.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement('a');
    link.download = 'trazo-libre.png';
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
  }, 'image/png');
};

new ResizeObserver(resize).observe(paper);
resize();
updateButtons();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
