/**
 * Counter —— React Bits 组件（本项目 vendor 形态）
 *
 * ① 来源
 *    - registry 端点：https://reactbits.dev/r/Counter-TS-CSS
 *    - 官方页面：https://www.reactbits.dev/components/counter
 *    官方依赖 `motion@^12.23.12`：本项目是 motion 14，同样从 `'motion/react'` 导入
 *    （`bangumi/vite.config.ts` 的 alias 与 `web/tsconfig.json` 的 paths 都已注册），
 *    不新增依赖。
 *
 * ② 本地相对官方源码改了什么
 *    1. 颜色 props 默认值令牌化：`textColor` 默认由 `'inherit'` 改成
 *       `var(--bgm-text-strong)`；`gradientFrom` 默认由 `'black'` 改成
 *       `var(--bgm-surface)`（那是深色演示页的底色，浅色界面里要跟白面对齐；
 *       `gradientTo` 保持 `transparent`——渐隐到无色没有令牌可替）。
 *    2. CSS 类名加 `counter` 前缀，见 Counter.css 头部注释。
 *    3. 修正官方把 hooks 放在 `place === '.'` 提前 return 之后的问题：`.` 分支不调用
 *       hooks，一旦 `places` 变化导致实例在「数字」与「小数点」之间复用，hooks 数量
 *       就会变，React 会直接抛错。这里把 `useSpring` / `useMotionValue` / `useEffect`
 *       提到 return 之前（小数点分支算出的值不会用到，无副作用）。
 *    4. 尊重 `prefers-reduced-motion: reduce`：官方靠 motion 的弹簧滚动数字，而
 *       `MotionConfig reducedMotion="user"` 拦不住 `useSpring` 这条 MotionValue 链路，
 *       所以这里显式读 `useReducedMotion()`——开启时改用一个普通 MotionValue，数字
 *       直接出现在终值上，不滚动。
 *    5. 类型收口：`MotionValue` 走 type-only 导入，`CSSProperties` 用具名 type 导入
 *       （`verbatimModuleSyntax` 不接受把类型当值导入）；`CounterProps` 导出，
 *       与本目录其它 vendor 组件（TextTypeProps / CountUpProps …）一致。
 *    6. 循环：官方本来就是一次性（值变一次、滚一次），本地保持非循环。
 *
 * ③ 为什么改
 *    本项目只走 Bangumi 浅色令牌（`styles/bgm.css`），样式文件是全局作用域，并且
 *    必须能在系统「减少动态效果」下降级；官方源码的深色默认色、通用类名与无条件
 *    弹簧滚动，直接落地会同时带进硬编码色值、类名冲突和不可降级的动效。
 *
 * 动效范围：只动 transform（数字轮盘的 `y`）与 opacity，不做 layout 动画。
 */

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'motion/react';
import { useEffect, type CSSProperties } from 'react';
import './Counter.css';

type PlaceValue = number | '.';

interface NumberProps {
  mv: MotionValue<number>;
  number: number;
  height: number;
}

function Number({ mv, number, height }: NumberProps) {
  const y = useTransform(mv, latest => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) {
      memo -= 10 * height;
    }
    return memo;
  });

  return (
    <motion.span className="counterNumber" style={{ y }}>
      {number}
    </motion.span>
  );
}

function normalizeNearInteger(num: number): number {
  const nearest = Math.round(num);
  const tolerance = 1e-9 * Math.max(1, Math.abs(num));
  return Math.abs(num - nearest) < tolerance ? nearest : num;
}

function getValueRoundedToPlace(value: number, place: number): number {
  const scaled = value / place;
  return Math.floor(normalizeNearInteger(scaled));
}

interface DigitProps {
  place: PlaceValue;
  value: number;
  height: number;
  /** 系统「减少动态效果」开启：数字直接落终值，不滚 */
  reducedMotion: boolean;
  /** 显式带上 undefined：本项目开了 exactOptionalPropertyTypes，可选属性不接受
   *  「存在但值为 undefined」的传法（Counter 会把可选的 digitStyle 原样透传下来） */
  digitStyle?: CSSProperties | undefined;
}

function Digit({ place, value, height, reducedMotion, digitStyle }: DigitProps) {
  // hooks 必须在提前 return 之前：官方把它们放在 `place === '.'` 分支之后，
  // 实例在「数字 / 小数点」之间复用时 hooks 数量会变（详见文件头 ②.3）。
  const valueRoundedToPlace = place === '.' ? 0 : getValueRoundedToPlace(value, place);
  const animatedValue = useSpring(valueRoundedToPlace);
  const instantValue = useMotionValue(valueRoundedToPlace);

  useEffect(() => {
    if (reducedMotion) {
      instantValue.set(valueRoundedToPlace);
    } else {
      animatedValue.set(valueRoundedToPlace);
    }
  }, [animatedValue, instantValue, reducedMotion, valueRoundedToPlace]);

  if (place === '.') {
    return (
      <span className="counterDigit" style={{ height, ...digitStyle, width: 'fit-content' }}>
        .
      </span>
    );
  }

  return (
    <span className="counterDigit" style={{ height, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={reducedMotion ? instantValue : animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

export interface CounterProps {
  value: number;
  fontSize?: number;
  padding?: number;
  /**
   * 决定显示哪些数位。小数位用 `"."` 表示小数点。
   * 留空（不传）时按当前 value 自动推导。
   */
  places?: PlaceValue[];
  gap?: number;
  borderRadius?: number;
  horizontalPadding?: number;
  textColor?: string;
  fontWeight?: CSSProperties['fontWeight'];
  containerStyle?: CSSProperties;
  counterStyle?: CSSProperties;
  digitStyle?: CSSProperties;
  gradientHeight?: number;
  gradientFrom?: string;
  gradientTo?: string;
  topGradientStyle?: CSSProperties;
  bottomGradientStyle?: CSSProperties;
}

export function Counter({
  value,
  fontSize = 100,
  padding = 0,
  places = [...value.toString()].map((ch, i, a) => {
    if (ch === '.') {
      return '.';
    }
    const dotIndex = a.indexOf('.');
    const isInteger = dotIndex === -1;

    const exponent = isInteger ? a.length - i - 1 : i < dotIndex ? dotIndex - i - 1 : -(i - dotIndex);

    return 10 ** exponent;
  }),
  gap = 8,
  borderRadius = 4,
  horizontalPadding = 8,
  // 官方是 'inherit'：这里显式给令牌，避免调用方漏传时颜色落回不可控的继承值
  textColor = 'var(--bgm-text-strong)',
  fontWeight = 'inherit',
  containerStyle,
  counterStyle,
  digitStyle,
  gradientHeight = 16,
  // 官方是 'black'（深色演示页底色）：浅色界面里两端渐隐要对齐白面
  gradientFrom = 'var(--bgm-surface)',
  gradientTo = 'transparent',
  topGradientStyle,
  bottomGradientStyle
}: CounterProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const height = fontSize + padding;

  const defaultCounterStyle: CSSProperties = {
    fontSize,
    gap,
    borderRadius,
    paddingLeft: horizontalPadding,
    paddingRight: horizontalPadding,
    color: textColor,
    fontWeight,
    direction: 'ltr'
  };

  const defaultTopGradientStyle: CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to bottom, ${gradientFrom}, ${gradientTo})`
  };

  const defaultBottomGradientStyle: CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})`
  };

  return (
    <span className="counterContainer" style={containerStyle}>
      <span className="counterValue" style={{ ...defaultCounterStyle, ...counterStyle }}>
        {places.map(place => (
          <Digit key={place} place={place} value={value} height={height} reducedMotion={reducedMotion} digitStyle={digitStyle} />
        ))}
      </span>
      <span className="counterGradientOverlay">
        <span className="counterGradientTop" style={topGradientStyle ?? defaultTopGradientStyle} />
        <span className="counterGradientBottom" style={bottomGradientStyle ?? defaultBottomGradientStyle} />
      </span>
    </span>
  );
}

export default Counter;
