import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { I18nProvider } from './i18n'
import { BioTwin } from './pages/BioTwin'
import { EarlyWarning } from './pages/EarlyWarning'
import { Login } from './pages/Login'
import { MissionControl } from './pages/MissionControl'
import { MissionLink } from './pages/MissionLink'
import { RescueWindow } from './pages/RescueWindow'
import { Settings } from './pages/Settings'
import { SpaceEnvironment } from './pages/SpaceEnvironment'
import { VitalScan } from './pages/VitalScan'
import { AppProvider, useApp } from './state'

function Gate() {
  const { session } = useApp()
  if (!session) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MissionControl />} />
        <Route path="bio-twin" element={<BioTwin />} />
        <Route path="vital-scan" element={<VitalScan />} />
        <Route path="early-warning" element={<EarlyWarning />} />
        <Route path="rescue-window" element={<RescueWindow />} />
        <Route path="rescue-window/:id" element={<RescueWindow />} />
        <Route path="environment" element={<SpaceEnvironment />} />
        <Route path="mission-link" element={<MissionLink />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AppProvider>
    </I18nProvider>
  )
}
