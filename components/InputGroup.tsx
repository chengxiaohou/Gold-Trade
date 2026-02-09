
import React, { useRef, useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, X, GripHorizontal, RotateCcw } from 'lucide-react';

interface InputGroupProps {
  label?: string;
  value: number | string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  step?: number;
  unit?: string;
  isQuantity?: boolean;
  inputClassName?: string;
  containerClassName?: string;
  hideLabel?: boolean;
}

// --- 可拖拽的 3D 滚轮气泡 ---
const DraggableWheelBubble: React.FC<{
  initialPosition: { top: number, left: number };
  currentValue: number;
  step: number;
  unit: string;
  label: string;
  onChange: (val: string) => void;
  onClose: () => void;
}> = ({ initialPosition, currentValue, step, unit, label, onChange, onClose }) => {
  const [position, setPosition] = useState(initialPosition);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  
  // 核心修复状态
  const [isReady, setIsReady] = useState(false);
  const itemHeight = 32; 
  const [baseValue] = useState(currentValue);

  // 1. 生成稳定的选项列表
  const options = useMemo(() => {
    const list = [];
    const normalizedStep = step || 0.01;
    // 生成前后各 120 个步长，增加滚轮的视觉厚度
    for (let i = -120; i <= 120; i++) {
      const v = Math.round((baseValue + i * normalizedStep) * 100) / 100;
      if (v >= 0) {
        list.push(v);
      }
    }
    return Array.from(new Set(list)).sort((a, b) => a - b);
  }, [step, baseValue]);

  // 2. 预计算目标索引
  const targetIndex = useMemo(() => {
    const target = Math.round(baseValue * 100) / 100;
    let idx = options.indexOf(target);
    if (idx === -1) {
       let minDiff = Number.MAX_VALUE;
       options.forEach((opt, i) => {
         const diff = Math.abs(opt - target);
         if (diff < minDiff) {
           minDiff = diff;
           idx = i;
         }
       });
    }
    return idx === -1 ? 0 : idx;
  }, [options, baseValue]);

  const [activeIndex, setActiveIndex] = useState(targetIndex);

  // 3. 滚动处理逻辑
  const handleScroll = () => {
    // 只有在准备就绪后才允许更新状态，防止初始化时的 0 滚动事件干扰
    if (!isReady || !scrollRef.current) return;

    const scrollTop = scrollRef.current.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    
    if (options[index] !== undefined && index !== activeIndex) {
      setActiveIndex(index);
      const val = options[index];
      const valStr = Number.isInteger(val) ? val.toString() : val.toFixed(2);
      onChange(valStr);
      if (window.navigator.vibrate) window.navigator.vibrate(5);
    }
  };

  // 4. 强制初始化滚动位置
  useLayoutEffect(() => {
    if (scrollRef.current) {
      const scrollTarget = targetIndex * itemHeight;
      scrollRef.current.scrollTop = scrollTarget;
      
      // 使用双重 requestAnimationFrame 确保在浏览器重绘后再次校准
      // 这是解决 Portal 首次挂载高度计算滞后的终极方案
      let rafId: number;
      const syncScroll = () => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollTarget;
          setIsReady(true);
        }
      };
      
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(syncScroll);
      });

      return () => cancelAnimationFrame(rafId);
    }
  }, [targetIndex]);

  // --- 拖拽交互逻辑 ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!bubbleRef.current || e.button !== 0) return;
    e.preventDefault();
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDragging.current || !bubbleRef.current) return;
      const newLeft = moveEvent.clientX - dragOffset.current.x;
      const newTop = moveEvent.clientY - dragOffset.current.y;
      bubbleRef.current.style.left = `${newLeft}px`;
      bubbleRef.current.style.top = `${newTop}px`;
    };

    const onPointerUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (bubbleRef.current) {
        const rect = bubbleRef.current.getBoundingClientRect();
        setPosition({ left: rect.left, top: rect.top });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    bubbleRef.current.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    const valStr = Number.isInteger(baseValue) ? baseValue.toString() : baseValue.toFixed(2);
    onChange(valStr);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: targetIndex * itemHeight, behavior: 'smooth' });
      setActiveIndex(targetIndex);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        ref={bubbleRef}
        style={{ 
          top: position.top, 
          left: position.left, 
          width: '220px',
          opacity: isReady ? 1 : 0, // 在对齐完成前保持不可见，防止闪烁
          transform: isReady ? 'scale(1)' : 'scale(0.95)',
          transition: 'opacity 0.15s ease-out, transform 0.15s ease-out'
        }}
        className="fixed z-[9999] bg-app-card border border-app-border shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] rounded-xl flex flex-col overflow-hidden"
      >
        {/* 顶部标题栏 */}
        <div 
          onPointerDown={handlePointerDown}
          className="bg-app-bg/95 backdrop-blur-xl p-2.5 flex justify-between items-center border-b border-white/5 cursor-grab active:cursor-grabbing select-none touch-none"
        >
          <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
            <GripHorizontal size={14} className="opacity-60"/>
            <h4 className="text-[10px] font-bold tracking-widest uppercase truncate max-w-[110px]">{label}</h4>
          </div>
          <div className="flex items-center gap-1.5">
            <button 
              onClick={handleReset} 
              className="text-app-subtext hover:text-brand-yellow transition-colors bg-white/5 hover:bg-white/10 rounded-md p-1.5"
            >
              <RotateCcw size={12} />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onClose(); }} 
              className="text-app-subtext hover:text-app-text transition-colors bg-white/5 hover:bg-white/10 rounded-md p-1.5"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 滚轮内容区 */}
        <div className="relative bg-app-bg/40 flex items-center justify-center overflow-hidden h-40">
          <div className="absolute top-1/2 -translate-y-1/2 w-full pointer-events-none h-8 z-10">
            <div className="absolute top-0 inset-x-0 h-[1px] bg-brand-yellow/40" />
            <div className="absolute bottom-0 inset-x-0 h-[1px] bg-brand-yellow/40" />
            <div className="absolute inset-0 bg-brand-yellow/[0.08]" />
          </div>
          
          <div 
            ref={scrollRef} 
            onScroll={handleScroll} 
            className="w-full h-full overflow-y-scroll no-scrollbar snap-y snap-mandatory cursor-ns-resize touch-pan-y"
          >
            <div style={{ height: (160 - 32) / 2 }} />
            <div className="flex flex-col items-center">
              {options.map((opt, i) => {
                const distance = Math.abs(i - activeIndex);
                // 优化透明度计算：确保目标项始终是清晰的
                const opacity = distance === 0 ? 1 : Math.max(0.12, 1 - distance * 0.35);
                const rotateX = (i - activeIndex) * 22;
                const scale = distance === 0 ? 1.15 : Math.max(0.85, 1 - distance * 0.05);
                
                return (
                  <div 
                    key={i} 
                    className="flex items-center justify-center snap-center w-full" 
                    style={{ 
                      height: `32px`, 
                      opacity, 
                      transform: `rotateX(${rotateX}deg) scale(${scale})`, 
                      perspective: '600px',
                      transformStyle: 'preserve-3d',
                      transition: isReady ? 'transform 0.1s ease-out, opacity 0.1s ease-out' : 'none'
                    }}
                  >
                    <span className={`font-mono text-sm tracking-tight ${distance === 0 ? 'text-brand-yellow font-black drop-shadow-[0_0_10px_rgba(254,192,7,0.4)]' : 'text-app-subtext'}`}>
                      {opt.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ height: (160 - 32) / 2 }} />
          </div>
          
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-app-bg/95 via-transparent to-app-bg/95" />
        </div>
        
        <div className="bg-app-card py-1.5 border-t border-white/5 text-center">
           <span className="text-[9px] text-app-subtext/60 font-bold uppercase tracking-[0.3em]">{unit || 'SELECTOR'}</span>
        </div>
      </div>
    </>,
    document.body
  );
};

export const InputGroup: React.FC<InputGroupProps> = ({
  label = "",
  value,
  onChange,
  type = "number",
  placeholder,
  step = 0.01,
  unit = "",
  inputClassName = "",
  containerClassName = "",
  hideLabel = false
}) => {
  const inputRef = useRef<HTMLDivElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  
  const handleTriggerPicker = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (inputRef.current) {
      setAnchorRect(inputRef.current.getBoundingClientRect());
      setShowPicker(true);
    }
  };

  return (
    <div className={`flex flex-col space-y-1.5 w-full group/input relative ${containerClassName}`} ref={inputRef}>
      {!hideLabel && label && <label className="text-[10px] text-app-subtext font-medium ml-1 truncate">{label}</label>}
      <div className="relative flex items-center h-full min-h-[40px]">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`no-spinners w-full h-full bg-app-input border border-app-border text-app-text rounded-lg pl-3 pr-10 focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-base placeholder-app-subtext/50 ${inputClassName}`}
        />

        <div 
          className="absolute right-0 inset-y-0 flex items-stretch z-20 cursor-pointer"
          onClick={handleTriggerPicker}
        >
           <div className="w-[1px] bg-app-border h-2/3 my-auto opacity-50"></div>
           <div className="flex flex-col justify-center w-8 opacity-60 group-hover/input:opacity-100 hover:text-brand-yellow transition-all">
              <div className="flex-1 flex items-center justify-center">
                <ChevronUp size={14} strokeWidth={3} />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <ChevronDown size={14} strokeWidth={3} />
              </div>
           </div>
        </div>

        {unit && (
          <div className="absolute right-10 inset-y-0 flex items-center pointer-events-none">
             <span className="text-app-subtext text-xs font-bold">{unit}</span>
          </div>
        )}

        {showPicker && anchorRect && (
          <DraggableWheelBubble 
            initialPosition={{
              top: anchorRect.bottom + 8 + (anchorRect.bottom + 210 > window.innerHeight ? -anchorRect.height - 218 : 0),
              left: Math.max(10, Math.min(window.innerWidth - 240, anchorRect.right - 220))
            }}
            label={label}
            currentValue={parseFloat(value.toString()) || 0}
            step={step}
            unit={unit}
            onClose={() => setShowPicker(false)}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
};
