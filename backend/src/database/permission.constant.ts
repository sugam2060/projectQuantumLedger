const PERMISSION = {
  CREATE_USER: {
    id: 1,
    name: 'user:create',
    description: 'Permission to create a new user',
  },

  READ_USER: {
    id: 2,
    name: 'user:read',
    description: 'Permission to read user information',
  },
};

export type PermissionName =
  (typeof PERMISSION)[keyof typeof PERMISSION]['name'];
