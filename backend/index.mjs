
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const ROLE_TO_GROUP = {
  Administrator: "administrators",
  Finance: "finance",
  Staff: "staff",
};

const MANAGED_GROUPS = Object.values(ROLE_TO_GROUP);
const ROLE_PRIORITY = ["Administrator", "Finance", "Staff"];

const DEPARTMENTS = [
  "Management",
  "Administration",
  "Programmes",
  "Finance",
  "Communications",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Allow-Methods":
        "GET,POST,PATCH,DELETE,OPTIONS",
      "Vary": "Origin",
    },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

function getClaims(event) {
  return (
    event.requestContext?.authorizer?.jwt?.claims ||
    event.requestContext?.authorizer?.claims ||
    {}
  );
}

function parseGroups(raw) {
  if (Array.isArray(raw)) {
    return raw.map(String);
  }

  if (typeof raw !== "string") {
    return [];
  }

  const value = raw.trim().replace(/^\[|\]$/g, "");

  return value
    .split(/[,\s]+/)
    .map((group) => group.trim())
    .filter(Boolean);
}

function requireAdministrator(claims) {
  const groups = parseGroups(claims["cognito:groups"])
    .map((group) => group.toLowerCase());

  if (!groups.includes("administrators")) {
    throw new HttpError(
      403,
      "Administrator access is required."
    );
  }
}

function getCallerUsername(claims) {
  return (
    claims["cognito:username"] ||
    claims.username ||
    ""
  );
}

function parseBody(event) {
  try {
    if (!event.body) return {};

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    return JSON.parse(body);
  } catch {
    throw new HttpError(
      400,
      "The request body must be valid JSON."
    );
  }
}

function cleanName(value) {
  const name = String(value || "").trim();

  if (!name) {
    throw new HttpError(400, "Name is required.");
  }

  if (name.length > 100) {
    throw new HttpError(400, "Name is too long.");
  }

  return name;
}

function cleanRole(value) {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(ROLE_TO_GROUP, value)
  ) {
    throw new HttpError(400, "Invalid role.");
  }

  return value;
}

function cleanDepartment(value) {
  if (
    typeof value !== "string" ||
    !DEPARTMENTS.includes(value)
  ) {
    throw new HttpError(400, "Invalid department.");
  }

  return value;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new HttpError(400, "Enter a valid email address.");
  }

  return email;
}

async function listAllUsers() {
  const users = [];
  let token;

  do {
    const result = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: token,
      })
    );

    users.push(...(result.Users || []));
    token = result.PaginationToken;
  } while (token);

  return users;
}

async function loadGroupMembership() {
  const membership = new Map();

  for (const group of MANAGED_GROUPS) {
    let token;

    do {
      let result;

      try {
        result = await client.send(
          new ListUsersInGroupCommand({
            UserPoolId: USER_POOL_ID,
            GroupName: group,
            Limit: 60,
            NextToken: token,
          })
        );
      } catch (error) {
        if (error.name === "ResourceNotFoundException") {
          break;
        }

        throw error;
      }

      for (const user of result.Users || []) {
        if (!membership.has(user.Username)) {
          membership.set(user.Username, new Set());
        }

        membership.get(user.Username).add(group);
      }

      token = result.NextToken;
    } while (token);
  }

  return membership;
}

function roleFromGroups(groups) {
  const names = groups ? [...groups] : [];

  for (const role of ROLE_PRIORITY) {
    if (names.includes(ROLE_TO_GROUP[role])) {
      return role;
    }
  }

  return "Staff";
}

function toApiUser(user, membership) {
  const attributes = Object.fromEntries(
    (user.Attributes || []).map((attribute) => [
      attribute.Name,
      attribute.Value,
    ])
  );

  return {
    username: user.Username,
    name: attributes.name || "",
    email: attributes.email || "",
    department: attributes["custom:department"] || "",
    role: roleFromGroups(membership.get(user.Username)),
    status: user.Enabled ? "Active" : "Inactive",
    userStatus: user.UserStatus || "",
    createdAt: user.UserCreateDate
      ? new Date(user.UserCreateDate).toISOString()
      : null,
    lastLogin: null,
  };
}

async function setRole(username, role) {
  const targetGroup = ROLE_TO_GROUP[role];

  const result = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );

  const currentGroups = (result.Groups || [])
    .map((group) => group.GroupName)
    .filter(Boolean);

  for (const group of currentGroups) {
    if (
      MANAGED_GROUPS.includes(group) &&
      group !== targetGroup
    ) {
      await client.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: group,
        })
      );
    }
  }

  if (!currentGroups.includes(targetGroup)) {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: targetGroup,
      })
    );
  }
}

async function listUsers() {
  const [users, membership] = await Promise.all([
    listAllUsers(),
    loadGroupMembership(),
  ]);

  return respond(200, {
    users: users.map((user) => toApiUser(user, membership)),
  });
}

async function createUser(event) {
  const body = parseBody(event);

  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const department = cleanDepartment(body.department);
  const role = cleanRole(body.role);

  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      DesiredDeliveryMediums: ["EMAIL"],
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: name },
        { Name: "custom:department", Value: department },
      ],
    })
  );

  try {
    await setRole(email, role);
  } catch (error) {
    await client
      .send(
        new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
        })
      )
      .catch(() => {});

    throw error;
  }

  return respond(201, {
    message: "Staff account created. Cognito will send the invitation.",
  });
}

async function updateUser(event, username, callerUsername) {
  const body = parseBody(event);

  const name = cleanName(body.name);
  const department = cleanDepartment(body.department);
  const role = cleanRole(body.role);

  if (
    username === callerUsername &&
    role !== "Administrator"
  ) {
    throw new HttpError(
      400,
      "You cannot remove your own administrator role."
    );
  }

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [
        { Name: "name", Value: name },
        { Name: "custom:department", Value: department },
      ],
    })
  );

  await setRole(username, role);

  return respond(200, {
    message: "Staff account updated.",
  });
}

async function setStatus(event, username, callerUsername) {
  const body = parseBody(event);

  if (typeof body.enabled !== "boolean") {
    throw new HttpError(
      400,
      "`enabled` must be true or false."
    );
  }

  if (!body.enabled && username === callerUsername) {
    throw new HttpError(
      400,
      "You cannot deactivate your own account."
    );
  }

  const Command = body.enabled
    ? AdminEnableUserCommand
    : AdminDisableUserCommand;

  await client.send(
    new Command({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );

  return respond(200, {
    message: body.enabled
      ? "Account activated."
      : "Account deactivated.",
  });
}

async function deleteUser(username, callerUsername) {
  if (username === callerUsername) {
    throw new HttpError(
      400,
      "You cannot delete your own account."
    );
  }

  await client.send(
    new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );

  return respond(200, {
    message: "Staff account removed.",
  });
}

export const handler = async (event) => {
  try {
    if (!USER_POOL_ID) {
      throw new Error("USER_POOL_ID is not configured.");
    }

    const method =
      event.requestContext?.http?.method ||
      event.httpMethod ||
      "";

    const path = (event.rawPath || event.path || "")
      .replace(/\/+$/, "");

    if (method === "OPTIONS") {
      return respond(204);
    }

    const claims = getClaims(event);

    // API Gateway must validate the JWT before this Lambda runs.
    // This additional check restricts administrative operations.
    requireAdministrator(claims);

    const callerUsername = getCallerUsername(claims);

    const match = path.match(
      /\/admin\/users(?:\/([^/]+))?(?:\/(status))?$/
    );

    if (!match) {
      throw new HttpError(404, "Not found.");
    }

    const username = match[1]
      ? decodeURIComponent(match[1])
      : null;

    const isStatusRoute = match[2] === "status";

    if (!username && method === "GET") {
      return await listUsers();
    }

    if (!username && method === "POST") {
      return await createUser(event);
    }

    if (username && isStatusRoute && method === "PATCH") {
      return await setStatus(
        event,
        username,
        callerUsername
      );
    }

    if (username && !isStatusRoute && method === "PATCH") {
      return await updateUser(
        event,
        username,
        callerUsername
      );
    }

    if (username && !isStatusRoute && method === "DELETE") {
      return await deleteUser(username, callerUsername);
    }

    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    if (error instanceof HttpError) {
      return respond(error.status, {
        message: error.message,
      });
    }

    switch (error.name) {
      case "UsernameExistsException":
        return respond(409, {
          message: "A user with this email already exists.",
        });

      case "UserNotFoundException":
        return respond(404, {
          message: "User not found.",
        });

      case "InvalidParameterException":
        return respond(400, {
          message: error.message,
        });

      case "LimitExceededException":
      case "TooManyRequestsException":
        return respond(429, {
          message: "Too many requests. Please try again shortly.",
        });

      case "NotAuthorizedException":
      case "AccessDeniedException":
        console.error("AWS permission error:", error.name);

        return respond(403, {
          message: "The operation is not authorized.",
        });

      default:
        console.error("Unhandled Lambda error:", error);

        return respond(500, {
          message: "Internal server error.",
        });
    }
  }
};