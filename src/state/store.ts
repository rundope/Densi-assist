import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Project } from '../core/types';
import { newProject } from './project';

// 타입 배열(Float32Array 등)이 들어가지 않으므로 freeze는 켜 두어도 되지만,
// 대형 프로젝트에서 복사 비용을 줄이기 위해 끈다.
setAutoFreeze(false);

export type Tab = 'analyze' | 'results' | 'calibration';
export type Tool = 'select' | 'lane' | 'band' | 'baseline';
export type Section = 'image' | 'background' | 'lanes' | 'baseline' | 'bands';

/** 도구를 바꾸면 오른쪽 패널에서 그 단계에 맞는 항목만 펼친다 */
export const SECTIONS_FOR_TOOL: Record<Tool, Section[]> = {
  select: ['image'],
  lane: ['background', 'lanes'],
  band: ['bands'],
  baseline: ['baseline'],
};

export interface UiState {
  tab: Tab;
  activeGelId: string | null;
  selectedLaneId: string | null;
  selectedBandId: string | null;
  tool: Tool;
  gridView: boolean;
  openSections: Section[];
  calibrationId: string | null;
  profileHeight: number;
  showAllLanes: boolean;
  /** 레인 폭·높이를 모든 레인에 함께 적용 */
  syncLaneSize: boolean;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  lastEdit: { key: string; at: number } | null;
  ui: UiState;
  toasts: Toast[];
  saveState: 'saved' | 'saving' | 'dirty' | 'error';
  update: (recipe: (draft: Project) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;
  setUi: (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) => void;
  setTool: (tool: Tool) => void;
  toast: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismissToast: (id: number) => void;
  setSaveState: (s: AppState['saveState']) => void;
}

const HISTORY = 150;
let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  project: newProject(),
  past: [],
  future: [],
  lastEdit: null,
  ui: {
    tab: 'analyze',
    activeGelId: null,
    selectedLaneId: null,
    selectedBandId: null,
    tool: 'select',
    gridView: false,
    // 처음에는 모두 접어 두고, 필요한 단계만 펼쳐 쓰게 한다
    openSections: [],
    calibrationId: null,
    profileHeight: 300,
    showAllLanes: false,
    syncLaneSize: true,
  },
  toasts: [],
  saveState: 'saved',

  update: (recipe, coalesceKey) => {
    const { project, past, lastEdit } = get();
    const next = produce(project, (d) => {
      recipe(d);
      d.updatedAt = new Date().toISOString();
    });
    const now = Date.now();
    // 슬라이더 드래그처럼 같은 키로 연달아 바뀌면 하나의 되돌리기 단계로 묶는다
    const coalesce = coalesceKey && lastEdit && lastEdit.key === coalesceKey && now - lastEdit.at < 1200;
    set({
      project: next,
      past: coalesce ? past : [...past.slice(-HISTORY + 1), project],
      future: [],
      lastEdit: coalesceKey ? { key: coalesceKey, at: now } : null,
      saveState: 'dirty',
    });
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastEdit: null, saveState: 'dirty' });
    get().setUi((ui) => sanitizeUi(ui, get().project));
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], lastEdit: null, saveState: 'dirty' });
    get().setUi((ui) => sanitizeUi(ui, get().project));
  },

  loadProject: (p) => {
    set({ project: p, past: [], future: [], lastEdit: null, saveState: 'saved' });
    set((s) => ({
      ui: {
        ...s.ui,
        activeGelId: p.gels[0]?.id ?? null,
        selectedLaneId: p.gels[0]?.lanes[0]?.id ?? null,
        selectedBandId: null,
        calibrationId: p.calibrations[0]?.id ?? null,
      },
    }));
  },

  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...(typeof patch === 'function' ? patch(s.ui) : patch) } })),
  setTool: (tool) => set((s) => ({ ui: { ...s.ui, tool, gridView: false, openSections: SECTIONS_FOR_TOOL[tool] } })),

  toast: (t, ms = 4200) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    if (ms > 0) setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setSaveState: (saveState) => set({ saveState }),
}));

function sanitizeUi(ui: UiState, p: Project): Partial<UiState> {
  const gel = p.gels.find((g) => g.id === ui.activeGelId) ?? p.gels[0] ?? null;
  const lane = gel?.lanes.find((l) => l.id === ui.selectedLaneId) ?? null;
  const band = lane?.bands.find((b) => b.id === ui.selectedBandId) ?? null;
  return {
    activeGelId: gel?.id ?? null,
    selectedLaneId: lane?.id ?? gel?.lanes[0]?.id ?? null,
    selectedBandId: band?.id ?? null,
    calibrationId: p.calibrations.find((c) => c.id === ui.calibrationId)?.id ?? p.calibrations[0]?.id ?? null,
  };
}

// ---------------- 선택자 ----------------

export const useProject = () => useApp((s) => s.project);
export const useUi = () => useApp((s) => s.ui);

export function useActiveGel() {
  return useApp((s) => s.project.gels.find((g) => g.id === s.ui.activeGelId) ?? null);
}

export function useSelectedLane() {
  return useApp((s) => {
    const gel = s.project.gels.find((g) => g.id === s.ui.activeGelId);
    return gel?.lanes.find((l) => l.id === s.ui.selectedLaneId) ?? null;
  });
}

/** draft 안에서 겔/레인 찾기 */
export function findGel(d: Project, gelId: string | null) {
  return d.gels.find((g) => g.id === gelId);
}
export function findLane(d: Project, gelId: string | null, laneId: string | null) {
  return findGel(d, gelId)?.lanes.find((l) => l.id === laneId);
}
