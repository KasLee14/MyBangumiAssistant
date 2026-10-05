import type { ThemeConfig } from 'antd';

/**
 * 文档页的 antd 主题：**只映射配色与圆角**，让 antd 生成的骨架与站点其它页同色系。
 *
 * 这些值抄自 `styles/bgm.css` 的 `--bgm-*` 令牌。为什么不能直接写 `var(--bgm-primary)`：
 * antd 的 token 会参与颜色推导（hover / active / 边框的色阶由 @ant-design/colors 从主色算出），
 * 传一个 `var(...)` 字符串它算不出色阶，组件会退回默认蓝。所以这里只能写真实色值——
 * **改令牌时必须同步改这里**（这是引入 antd 的唯一代价，写在文档的 §规则 里）。
 *
 * 文档页不守本项目的其它外观约定（间距、阴影尺度自己定），只有配色必须与站点一致。
 */
export const LIBRARY_THEME: ThemeConfig = {
  token: {
    colorPrimary: '#f09199',        // --bgm-primary
    colorLink: '#0084b4',           // --bgm-link
    colorInfo: '#369cf8',           // --bgm-interactive
    colorText: '#444',              // --bgm-text
    colorTextSecondary: '#666',     // --bgm-text-muted
    colorTextTertiary: '#999',      // --bgm-text-weak
    colorTextHeading: '#333',       // --bgm-text-strong
    colorBgContainer: '#fff',       // --bgm-surface
    colorBgElevated: '#fff',        // --bgm-surface
    colorBgLayout: '#f5f5f5',       // --bgm-bg
    colorBorder: '#ddd',            // --bgm-border
    colorBorderSecondary: '#eee',   // --bgm-border-soft
    borderRadius: 10,               // --bgm-r-md
    borderRadiusSM: 5,              // --bgm-r-sm
    fontSize: 14,
    controlHeight: 36,
    fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Layout: {
      headerBg: '#fff',             // --bgm-surface
      headerHeight: 64,
      headerPadding: '0 24px',
      bodyBg: '#f5f5f5',            // --bgm-bg
      siderBg: '#fff',              // --bgm-surface
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: '#fdf0f1',    // --bgm-primary-soft
      itemSelectedColor: '#a8575f', // --bgm-primary-text
      itemHeight: 34,
      groupTitleColor: '#999',      // --bgm-text-weak
    },
    Table: {
      headerBg: '#fafafa',          // --bgm-surface-alt
      rowHoverBg: '#fafafa',        // --bgm-surface-alt
      cellPaddingBlockSM: 6,
    },
    Card: {
      paddingLG: 20,
    },
  },
};
