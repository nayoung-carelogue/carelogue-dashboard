# Carelogue DOM i18n

`index.js` translates the existing Korean React UI without requiring every
string in `App.jsx` to be rewritten. It observes the React root, translates new
popups, route content, accessible labels, and the browser tab title. It keeps
the original Korean value so the UI can be switched back safely.

## App integration

Import the hook in `App.jsx` and call it once near the top of `App`:

```jsx
import { useI18n } from './i18n/index.js';

function App() {
  const { language, setLanguage, languages } = useI18n();
  // existing state and rendering...
}
```

Connect the existing Language control to `setLanguage`. A native select is the
simplest accessible control:

```jsx
<select
  aria-label="Language"
  value={language}
  onChange={(event) => setLanguage(event.target.value)}
>
  {languages.map((item) => (
    <option key={item.value} value={item.value}>{item.label}</option>
  ))}
</select>
```

The chosen value (`ko`, `ja`, or `en`) is stored in `localStorage` under
`carelogue.language` and is restored on the next visit.

## Dictionary shape

`en.js` and `ja.js` should default-export a flat object whose keys are the
original Korean strings. Named exports called `en` and `ja` are also accepted.

```js
const ja = {
  '개인별 계획': '訪問介護計画',
  '수급자': '利用者',
};

export { ja };
export default ja;
```

Long phrases are matched before shorter terms. This lets a full sentence use a
natural translation while smaller dictionary entries cover dynamic content.
Unmatched dates, counts, spacing, and punctuation remain unchanged.

Add `data-i18n-ignore` or `translate="no"` to an element that must never be
translated. Text entered into an editable element is ignored automatically.
