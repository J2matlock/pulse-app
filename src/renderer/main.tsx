import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { PRODUCT_NAME } from '../shared/constants'

// index.html carries a static fallback title; the display name lives in one place
document.title = PRODUCT_NAME

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
