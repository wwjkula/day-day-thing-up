import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

// restore dev token if present
try { const t = localStorage.getItem('AUTH'); if (t) (window as any).__AUTH__ = t } catch {}

const app = createApp(App)
app.use(ElementPlus)
app.mount('#app')
