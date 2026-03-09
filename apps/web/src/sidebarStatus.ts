export interface SidebarThreadStatusPill {
  label: "Working" | "Connecting" | "Completed" | "Pending Approval";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export interface SidebarTerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

export interface SidebarPrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}
