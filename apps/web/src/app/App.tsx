import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { ImportPage } from "../features/importexport/ImportPage";
import { LongTaskListPage } from "../features/longtasks/LongTaskListPage";
import { StudentSchedulePage } from "../features/schedule/StudentSchedulePage";
import { StudentListPage } from "../features/students/StudentListPage";
import { StudentProfilePage } from "../features/students/StudentProfilePage";
import { TemplateDetailPage } from "../features/templates/TemplateDetailPage";
import { TemplateListPage } from "../features/templates/TemplateListPage";
import { TodayPage } from "../features/today/TodayPage";
import { VocabularyPage } from "../features/vocabulary/VocabularyPage";
import { StudentWorkbenchPage } from "../features/workbench/StudentWorkbenchPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate replace to="/today" />} />
        <Route
          path="/students/:studentId/profile"
          element={<StudentProfilePage />}
        />
        <Route
          path="/students/:studentId/vocabulary"
          element={<VocabularyPage />}
        />
        <Route
          path="/students/:studentId/schedule"
          element={<StudentSchedulePage />}
        />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/students" element={<StudentListPage />} />
        <Route path="/workbench" element={<StudentWorkbenchPage />} />
        <Route path="/long-tasks" element={<LongTaskListPage />} />
        {/* 课程模板（ITEMIZED）是 Excel 导入等高级场景的入口，保留路由但
            不进主导航；普通助教的主要路径是长期任务。 */}
        <Route path="/templates" element={<TemplateListPage />} />
        <Route path="/templates/:templateId" element={<TemplateDetailPage />} />
        <Route path="/imports" element={<ImportPage />} />
        <Route path="*" element={<Navigate replace to="/today" />} />
      </Route>
    </Routes>
  );
}
