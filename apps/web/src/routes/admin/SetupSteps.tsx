import { SetupStepList } from "@/features/admin/SetupSteps";
import { AdminHeader } from "./AdminLayout";

export function AdminSetupStepsPage() {
  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Setup steps" description="The same steps as the first-run setup, checked against how the server is set up now." />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-5">
          <SetupStepList />
        </div>
      </div>
    </div>
  );
}
