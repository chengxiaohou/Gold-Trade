import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';

export interface UseStepWheelOptions {
  /** 挂载 wheel / 触屏监听的元素 ref（输入框、图表容器等任意元素） */
  ref: RefObject<HTMLElement | null>;
  /** 当前值的 ref：外层用 effect 同步 value，事件闭包读到最新值，同时 hook 提交时也会就地更新它 */
  valueRef: MutableRefObject<number>;
  /** 步长 */
  step: number;
  /** 最小值/最大值，未传不限 */
  min?: number;
  max?: number;
  /** 保留小数位，默认 0（整数） */
  precision?: number;
  /** 是否启用触屏纵向拖拽调节（iOS 双指/拖拽），默认 false */
  touch?: boolean;
  /** 附加禁用判断（返回 true 则本次滚轮不生效）；未传则始终生效 */
  disabled?: () => boolean;
  /** 值变化回调：参数为已 clamp + 取整后的数字，由调用方自行决定如何格式化 */
  onChange: (next: number) => void;
}

/**
 * 统一的“滚轮 / 触控板 / 触屏拖拽”数值步进调节机制，供所有需要滚轮步进的控件复用。
 *
 * 规范：
 * - 累积 deltaY（阈值 40px）满阈值才步进，余量保留不清零 —— 触控板小增量可逐帧累积、最终触发
 * - 方向：deltaY>0（鼠标下滚 / 双指下滚）→ 数值增大；deltaY<0 → 数值减小
 * - 以 valueRef 为基准读值，提交时同步更新 valueRef，避免 React 渲染滞后造成重复叠加
 * - 同一帧内的多次变化用 requestAnimationFrame 合并为一次提交，避免中途多次重绘
 *
 * 用法：
 *   const valueRef = useRef<number>(value);
 *   useEffect(() => { valueRef.current = value; }, [value]);
 *   useStepWheel({ ref, valueRef, step, min, max, onChange: v => setValue(v) });
 */
export function useStepWheel({
  ref,
  valueRef,
  step,
  min,
  max,
  precision = 0,
  touch = false,
  disabled,
  onChange,
}: UseStepWheelOptions) {
  // 用 ref 缓存选项，监听只挂一次也不会拿到过期值
  const stepRef = useRef(step); stepRef.current = step;
  const minRef = useRef(min); minRef.current = min;
  const maxRef = useRef(max); maxRef.current = max;
  const precisionRef = useRef(precision); precisionRef.current = precision;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  // 值计算 + clamp + 取整（滚轮、触屏、按钮增减共用同一套数学）
  const computeNext = useCallback((current: number, delta: number) => {
    const mult = Math.pow(10, precisionRef.current);
    let next = Math.round((current + delta) * mult) / mult;
    if (minRef.current !== undefined) next = Math.max(minRef.current, next);
    if (maxRef.current !== undefined) next = Math.min(maxRef.current, next);
    return next;
  }, []);

  // 统一施加一次增量：读到基准值 → 算出 next → 就地更新 valueRef（供下次叠加）→ 通知 onChange
  const apply = useCallback((delta: number) => {
    const next = computeNext(valueRef.current, delta);
    valueRef.current = next;
    onChangeRef.current(next);
  }, [computeNext, valueRef]);

  // 滚轮 / 触控板
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    let rafId: number | null = null;
    const THRESHOLD = 40;
    const commit = () => {
      rafId = null;
      const steps = Math.floor(Math.abs(acc) / THRESHOLD);
      if (steps > 0) {
        const direction = acc > 0 ? 1 : -1; // 下滚(正值)→增大，上滚→减小
        apply(direction * stepRef.current * steps);
        acc -= direction * steps * THRESHOLD; // 仅扣已消费，余量保留
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (disabledRef.current?.()) return;
      e.preventDefault();
      acc += e.deltaY;
      if (rafId != null) return; // 本帧已排定，合并
      rafId = requestAnimationFrame(commit);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [ref, apply]);

  // 触屏纵向拖拽（iOS 等）：向上滑→数值增大
  useEffect(() => {
    if (!touch) return;
    const el = ref.current;
    if (!el) return;
    let lastY = 0;
    let acc = 0;
    const threshold = 15;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      lastY = e.touches[0].clientY;
      acc = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (e.cancelable) e.preventDefault();
      const y = e.touches[0].clientY;
      acc += lastY - y; // 向上滑（y 减小）→ deltaY>0 → 增大
      lastY = y;
      const steps = Math.floor(Math.abs(acc) / threshold);
      if (steps > 0) {
        const direction = acc > 0 ? 1 : -1;
        apply(direction * stepRef.current * steps);
        acc -= direction * steps * threshold;
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, [ref, touch, apply]);

  return apply;
}