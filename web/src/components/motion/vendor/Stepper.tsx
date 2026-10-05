/**
 * 来源：React Bits「Stepper」的 CSS 变体 TS 源码（registry 端点 https://reactbits.dev/r/Stepper-TS-CSS 的 files[].content），
 *       官方文档页 https://www.reactbits.dev/components/stepper 。
 * 本地改动（相对官方源码逐条）：
 *   1. 重写动画载体，杜绝 layout 动画：公版 StepContentWrapper 用 motion animate={{ height }} 弹簧撑开内容区、
 *      StepConnector 用 width 0 -> 100% 跑进度线，两者都触发布局重排。本地改成：内容区高度变化直接布局（无动画），
 *      进场/退场只动 opacity + translateX（CSS keyframes）；进度线固定尺寸 + transform: scaleX()（竖向时 scaleY()，
 *      transform-origin 在起点）；指示器圆圈只动 scale。全套只碰 transform / opacity。
 *   2. 配色令牌化：公版 #5227FF（主色）、#222、#a3a3a3、#fff、#3b82f6、#52525b 以及内联 style 里的
 *      `var(--border-primary, #222)` 全部改为令牌派生（--bgm-primary / --bgm-text / --bgm-text-muted /
 *      --bgm-border / --bgm-surface，层次用 color-mix 就地派生）。指示器与连接线的状态色由 data-state 属性驱动 CSS 过渡，
 *      不再由 motion 逐态插值颜色。
 *   3. 内容区测量 JS 整体删除：公版用 useLayoutEffect 量 offsetHeight 再喂给父级弹簧（渲染期读布局、强制同步重排），
 *      本地改为「透明底稿层自然撑高容器 + 绝对定位动画层」，因此没有任何测量与回写。
 *   4. 新增 orientation?: 'horizontal' | 'vertical'（默认 horizontal）与 showFooter?: boolean（默认 true）。
 *      竖向时指示器列在左、连接线变竖直线（同样只动 transform）；showFooter 便于把 Stepper 当成「进度指示 + 自渲染导航」的内嵌件。
 *   5. 指示器可点即键盘可达：公版指示器是 motion.div + onClick（不可聚焦、无 role）。本地在可点时渲染 <button type="button">，
 *      带 aria-current="step" 与 aria-label（第 N 步：标题）；disableStepIndicators 或只有一步时降级为不可聚焦的 <div>。
 *      标题从子元素 props 读出（StepProps.title），取不到时回退「步骤 N」。
 *   6. 字号 / 字重 / 行高 / 间距补齐（公版只有 .step-number 的 font-size），标题、内容的最小排版落到 CSS，
 *      避免组件落到页面里继承到不合适的字号。
 *   7. 类名加组件前缀并统一 camelCase：.outer-container -> .stepper、.step-circle-container -> .stepperPanel、
 *      .step-indicator-* -> .stepperIndicator*；去掉 `aspect-ratio: 4/3 | 2/1`（公版示例页的定高容器，不适合可复用组件）、
 *      去掉 'use client'、去掉只有示例才需要的 .step-content-default 语义。
 *   8. 内容不可见时不卸载而是标记 inert + aria-hidden（公版 isCompleted 时把高度压到 0 并卸载内容），
 *      避免完成态把已渲染内容整段丢掉；同时补 prefers-reduced-motion 静止分支（useReducedMotion + CSS 媒体查询）。
 *   9. 公版 completeButtonText 是写死的 'Complete'，本地提成 prop（默认值不变）。
 * 为什么改：
 *   - 项目外观层硬约定：只动 transform / opacity，不做 layout 动画。会话区的 content-visibility: auto 与流式期间的
 *     memo 都依赖结构稳定，motion 的 height/width 动画会强制重排并让二者失效。
 *   - 公版的量高方案每个内容块都要 useLayoutEffect + 状态回写，渲染期读 offsetHeight 会造成额外同步布局；
 *     底稿层方案零测量、零回写，也没有「动画层高度滞后于内容」的错位。
 *   - 配色必须走令牌（--bgm-*）才能适配浅色令牌体系与外观层，硬编码 #5227FF 不随主题变化。
 */

import {
  type AnimationEvent,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
  useCallback,
  useState
} from 'react';
import { motion, useReducedMotion } from 'motion/react';
import './Stepper.css';

/** 单步内容：调用方以 <Step> 作为 children 传入，官方即此形状 */
export interface StepProps {
  children: ReactNode;
  /** 步骤标题：用于指示器 aria-label / title，缺省时回退「步骤 N」 */
  title?: string;
}

/** 每步各自的修饰类：带动画层 keyframes 与指示器的状态过渡（表驱动，加形态只改表） */
const stepInClasses = ['stepperStepIn1', 'stepperStepIn2', 'stepperStepIn3'] as const;
const stepOutClasses = ['stepperStepOut1', 'stepperStepOut2', 'stepperStepOut3'] as const;

export interface RenderStepIndicatorProps {
  step: number;
  currentStep: number;
  onStepClick: (clicked: number) => void;
}

export interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  /** 每一步一个 <Step>，按顺序编号 */
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  /** 'vertical' 时指示器列在左、连接线为竖直线（只动 transform） */
  orientation?: 'horizontal' | 'vertical';
  /** 为 false 时不渲染内置的「返回 / 继续」底栏，由调用方自行驱动 */
  showFooter?: boolean;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  completeButtonText?: string;
  disableStepIndicators?: boolean;
  renderStepIndicator?: (props: RenderStepIndicatorProps) => ReactNode;
}

export function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  orientation = 'horizontal',
  showFooter = true,
  stepCircleContainerClassName = '',
  stepContainerClassName = '',
  contentClassName = '',
  footerClassName = '',
  backButtonProps,
  nextButtonProps,
  backButtonText = 'Back',
  nextButtonText = 'Continue',
  completeButtonText = 'Complete',
  disableStepIndicators = false,
  renderStepIndicator,
  className = '',
  ...rest
}: StepperProps): JSX.Element {
  const steps = Array.isArray(children) ? children : [children];
  const totalSteps = steps.length;
  // 内联的每个 <Step> 都带 --stepperStepFrom（滑动像素），这里只提供时长与缓动
  const stepAnimationVars = {
    '--stepperStepDuration': 'var(--app-dur-base)',
    '--stepperStepEase': 'var(--app-ease-out)'
  } as CSSProperties;

  const [currentStep, setCurrentStep] = useState<number>(() =>
    Math.min(Math.max(initialStep, 1), Math.max(totalSteps, 1))
  );
  // 只用于滑动方向，不再驱动高度
  const [direction, setDirection] = useState<number>(0);
  const isCompleted = totalSteps > 0 && currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;
  const stepsClickable = !disableStepIndicators && !isCompleted && totalSteps > 1;

  /** 从 <Step title="…"> 的 props 里读标题，供指示器的 aria-label 使用 */
  const readStepTitle = (index: number): string => {
    const step = steps[index];
    const title = step && typeof step === 'object' && 'props' in step ? (step.props as StepProps).title : undefined;
    return title ?? `步骤 ${index + 1}`;
  };

  const updateStep = useCallback(
    (newStep: number) => {
      const target = Math.min(Math.max(newStep, 1), totalSteps + 1);
      setCurrentStep(target);
      if (target > totalSteps) {
        onFinalStepCompleted();
      } else {
        onStepChange(target);
      }
    },
    [totalSteps, onFinalStepCompleted, onStepChange]
  );

  const handleStepSelect = useCallback(
    (clicked: number) => {
      if (clicked === currentStep || clicked < 1 || clicked > totalSteps) return;
      setDirection(clicked > currentStep ? 1 : -1);
      updateStep(clicked);
    },
    [currentStep, totalSteps, updateStep]
  );

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  }, [currentStep, updateStep]);

  const handleNext = useCallback(() => {
    setDirection(1);
    updateStep(isLastStep ? totalSteps + 1 : currentStep + 1);
  }, [isLastStep, currentStep, totalSteps, updateStep]);

  return (
    <div className={`stepper stepper--${orientation} ${className}`} {...rest}>
      <div className={`stepperPanel ${stepCircleContainerClassName}`}>
        <div className={`stepperIndicatorRow ${stepContainerClassName}`}>
          {steps.map((_, index) => {
            const stepNumber = index + 1;
            const isNotLastStep = index < totalSteps - 1;
            return (
              <div key={stepNumber} className="stepperIndicatorSlot">
                {renderStepIndicator ? (
                  renderStepIndicator({ step: stepNumber, currentStep, onStepClick: handleStepSelect })
                ) : (
                  <StepIndicator
                    step={stepNumber}
                    title={readStepTitle(index)}
                    currentStep={currentStep}
                    clickable={stepsClickable}
                    onClickStep={handleStepSelect}
                  />
                )}
                {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
              </div>
            );
          })}
        </div>

        <div className={`stepperContent ${contentClassName}`} style={stepAnimationVars}>
          <StepContent currentStep={currentStep} direction={direction} isCompleted={isCompleted}>
            {steps[currentStep - 1]}
          </StepContent>
        </div>

        {showFooter && (
          <div className={`stepperFooter ${footerClassName}`}>
            <div className={`stepperFooterNav ${currentStep !== 1 ? 'stepperFooterNavSpread' : ''}`}>
              {currentStep !== 1 && (
                <button
                  type="button"
                  {...backButtonProps}
                  className={`stepperBack ${backButtonProps?.className ?? ''}`}
                  disabled={backButtonProps?.disabled ?? false}
                  onClick={backButtonProps?.onClick ?? handleBack}
                >
                  {backButtonText}
                </button>
              )}
              <button
                type="button"
                {...nextButtonProps}
                className={`stepperNext ${nextButtonProps?.className ?? ''}`}
                disabled={nextButtonProps?.disabled ?? false}
                onClick={nextButtonProps?.onClick ?? handleNext}
              >
                {isLastStep ? completeButtonText : nextButtonText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Stepper;

/** 单步内容容器：padding 与排版的最小落点 */
export function Step({ children }: StepProps): JSX.Element {
  return <div className="stepperStep">{children}</div>;
}

interface StepContentProps {
  currentStep: number;
  direction: number;
  isCompleted: boolean;
  children: ReactNode;
}

/**
 * 内容区：透明底稿层自然撑高容器（高度变化直接布局、不做动画），上面叠绝对定位的动画层，只跑 opacity + translateX。
 * 零测量、零回写；退场层与进场层共用同一份 children（切换后 children 已是新步骤的内容，位移方向仍然正确），
 * 因此同一时刻只有一层可见、不会出现双份文本。
 */
function StepContent({ currentStep, direction, isCompleted, children }: StepContentProps) {
  const [exiting, setExiting] = useState<{ step: number; direction: number } | null>(null);
  const [renderedStep, setRenderedStep] = useState<number>(currentStep);

  if (renderedStep !== currentStep) {
    // 渲染期同步记账：切换当帧就把「上一帧的步骤」登记为退场层，避免先多渲染一帧静止内容
    setRenderedStep(currentStep);
    setExiting({ step: renderedStep, direction });
  }

  const activeIndex = Math.max(currentStep - 1, 0) % stepInClasses.length;
  const exitIndex = Math.max((exiting?.step ?? 1) - 1, 0) % stepOutClasses.length;
  const slideFrom = direction >= 0 ? 12 : -12;

  return (
    <div className="stepperStage">
      {/* 底稿层：只有它参与高度，内容不可见也不可被读到 */}
      <div className="stepperBackdrop" aria-hidden="true" inert>
        {isCompleted ? null : children}
      </div>

      <div
        key={currentStep}
        className={`stepperLayer ${stepInClasses[activeIndex]}`}
        style={{ '--stepperStepFrom': `${slideFrom}px` } as CSSProperties}
        aria-hidden={isCompleted || undefined}
        inert={isCompleted ? true : undefined}
      >
        {children}
      </div>

      {exiting !== null && (
        <div
          key={`stepperExit-${exiting.step}`}
          className={`stepperLayer stepperLayerOut ${stepOutClasses[exitIndex]}`}
          style={{ '--stepperStepFrom': `${exiting.direction >= 0 ? 12 : -12}px` } as CSSProperties}
          aria-hidden="true"
          inert
          onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
            if (event.target === event.currentTarget) setExiting(null);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface StepIndicatorProps {
  step: number;
  title: string;
  currentStep: number;
  clickable: boolean;
  onClickStep: (step: number) => void;
}

function StepIndicator({ step, title, currentStep, clickable, onClickStep }: StepIndicatorProps) {
  const status = currentStep === step ? 'active' : currentStep < step ? 'inactive' : 'complete';
  const reduceMotion = useReducedMotion();
  const isInteractive = clickable && step !== currentStep;
  const stateClass =
    status === 'active' ? 'stepperStepIsActive' : status === 'complete' ? 'stepperStepIsComplete' : '';
  const label = `第 ${step} 步：${title}`;

  const inner = (
    <motion.span
      className="stepperIndicatorInner"
      initial={false}
      animate={{ scale: status === 'active' && !reduceMotion ? 1.06 : 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {status === 'complete' ? (
        <StepCheckIcon className="stepperCheck" />
      ) : status === 'active' ? (
        <span className="stepperActiveDot" />
      ) : (
        <span className="stepperStepNumber">{step}</span>
      )}
    </motion.span>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className={`stepperIndicator ${stateClass}`}
        data-state={status}
        aria-current={status === 'active' ? 'step' : undefined}
        aria-label={label}
        title={title}
        onClick={() => onClickStep(step)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`stepperIndicator stepperIndicatorStatic ${stateClass}`} data-state={status} aria-label={label}>
      {inner}
    </div>
  );
}

interface StepConnectorProps {
  isComplete: boolean;
}

/** 连接线：固定尺寸，只动 transform（横向 scaleX / 竖向 scaleY），不做宽度动画 */
function StepConnector({ isComplete }: StepConnectorProps) {
  const reduceMotion = useReducedMotion();

  return (
    <span className="stepperConnector" aria-hidden="true">
      <motion.span
        className="stepperConnectorInner"
        initial={false}
        animate={{ scaleX: isComplete ? 1 : 0, scaleY: isComplete ? 1 : 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      />
    </span>
  );
}

interface StepCheckIconProps {
  className?: string;
}

/** 完成勾：用 CSS 描边位移画出，避免在 SVG 上再挂一层 motion */
function StepCheckIcon({ className }: StepCheckIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path className="stepperCheckPath" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
