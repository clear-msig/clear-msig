export type OrganizationMember = {
  address: string;
  email: string;
};

export type OrganizationRecord = {
  walletName: string;
  reason: string;
  createdBy: string;
  members: OrganizationMember[];
  createdAt: string;
};

export type OrganizationRegistry = {
  organizations: OrganizationRecord[];
};
