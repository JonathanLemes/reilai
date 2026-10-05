import { root } from '@lynx-js/react';

import '../../ui/base.css';
import { ThemeRoot } from '../../shared/theme';
import { Chat } from './Chat';

root.render(
  <ThemeRoot>
    <Chat />
  </ThemeRoot>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
