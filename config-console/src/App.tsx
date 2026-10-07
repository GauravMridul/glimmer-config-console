import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Layout } from "@/pages/Layout";
import { OverviewPage } from "@/pages/OverviewPage";
import { ServiceConfigurationPage } from "@/pages/ServiceConfigurationPage";
import { PartnerServiceMappingPage } from "@/pages/PartnerServiceMappingPage";
import { ServiceSfdcFieldMappingPage } from "@/pages/ServiceSfdcFieldMappingPage";
import { DemoPage } from "@/pages/DemoPage";
import { SmartImportPage } from "@/pages/SmartImportPage";
import { EsaAutoMapperPage } from "@/pages/EsaAutoMapperPage";
import { SfdcAutoMapperPage } from "@/pages/SfdcAutoMapperPage";
import { TestSequencePage } from "@/pages/TestSequencePage";
import { ExpressionReferencePage } from "@/pages/ExpressionReferencePage";

function LegacyEsaCustomFunctionsRedirect() {
  const [p] = useSearchParams();
  const q = p.get("q");
  const suffix = q ? `?esa=${encodeURIComponent(q)}` : "";
  return <Navigate to={`/expressions${suffix}#esa-custom`} replace />;
}

function LegacyDmCustomFunctionsRedirect() {
  const [p] = useSearchParams();
  const q = p.get("q");
  const suffix = q ? `?dm=${encodeURIComponent(q)}` : "";
  return <Navigate to={`/expressions${suffix}#dm-expressions`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="esa" element={<ServiceConfigurationPage />} />
        <Route path="esa/custom-functions" element={<LegacyEsaCustomFunctionsRedirect />} />
        <Route path="partners" element={<PartnerServiceMappingPage />} />
        <Route path="sfdc" element={<ServiceSfdcFieldMappingPage />} />
        <Route path="dm/custom-functions" element={<LegacyDmCustomFunctionsRedirect />} />
        <Route path="expressions" element={<ExpressionReferencePage />} />
        <Route path="smart" element={<SmartImportPage />} />
        <Route path="request-mapper" element={<Navigate to="/esa-auto-mapper" replace />} />
        <Route path="esa-auto-mapper" element={<EsaAutoMapperPage />} />
        <Route path="sfdc-auto-mapper" element={<SfdcAutoMapperPage />} />
        <Route path="demo" element={<DemoPage />} />
        <Route path="test" element={<TestSequencePage />} />
      </Route>
    </Routes>
  );
}
