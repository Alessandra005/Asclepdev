import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlueprintProvider } from '@blueprintjs/core'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import '@blueprintjs/select/lib/css/blueprint-select.css'
import '@blueprintjs/datetime/lib/css/blueprint-datetime.css'
import '@blueprintjs/table/lib/css/table.css'
import './styles.css'
import { GatewayError } from '@/api/errors'
import { App } from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // A 4xx (denied, not found) will not change on retry; only retry network and 5xx failures once.
      retry: (n, e) => !(e instanceof GatewayError && e.status > 0 && e.status < 500) && n < 1
    }
  }
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BlueprintProvider>
        <App />
      </BlueprintProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
