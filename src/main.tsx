import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import AuthGate from './auth/AuthGate'
import { AppProvider } from './store/AppStore'
import { ApiError } from './lib/api'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Konsol operator, bukan feed realtime — data tidak berubah sendiri di
      // belakang layar kecuali cron berjalan. Refetch saat fokus kembali sudah
      // cukup, polling terus-menerus hanya membakar baca D1.
      staleTime: 30_000,
      retry: (failureCount, error) =>
        // 401 tidak akan sembuh dengan diulang — biarkan AuthGate yang menangani.
        error instanceof ApiError && error.isUnauthorized ? false : failureCount < 2,
    },
  },
})

// AuthGate membungkus AppProvider, bukan sebaliknya: store tidak boleh mulai
// mengambil data sebelum ada sesi, kalau tidak setiap boot menembakkan
// serangkaian permintaan yang pasti 401.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
)
