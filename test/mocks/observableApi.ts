import type {MockAgent} from "undici";
import {type Interceptable} from "undici";
import {getObservableApiOrigin, getObservableUiOrigin} from "../../src/observableApiClient.js";
import {getCurrentAgent, mockAgent} from "./undici.js";

export const validApiKey = "MOCK-VALID-KEY";
export const invalidApiKey = "MOCK-INVALID-KEY";

const emptyErrorBody = JSON.stringify({errors: []});

let apiMock;

export function mockObservableApi() {
  mockAgent();

  beforeEach(() => {
    apiMock = new ObservableApiMock();
    const agent = getCurrentAgent();
    agent.get(getOrigin());
  });

  afterEach(() => {
    apiMock.after();
  });
}

export function getCurentObservableApi() {
  if (!apiMock) throw new Error("mockObservableApi not initialized");
  return apiMock;
}

function getOrigin() {
  return getObservableApiOrigin().toString().replace(/\/$/, "");
}

class ObservableApiMock {
  private _agent: MockAgent | null = null;
  private _handlers: ((pool: Interceptable) => void)[] = [];

  public start(): ObservableApiMock {
    this._agent = getCurrentAgent();
    const mockPool = this._agent.get(getOrigin());
    for (const handler of this._handlers) handler(mockPool);
    return this;
  }

  public after() {
    const agent = getCurrentAgent();
    for (const intercept of agent.pendingInterceptors()) {
      if (intercept.origin === getOrigin()) {
        console.log(`Expected all intercepts for ${getOrigin()} to be handled`);
        // This will include other interceptors that are not related to the
        // Observable API, but it has a nice output.
        agent.assertNoPendingInterceptors();
      }
    }
  }

  public pendingInterceptors() {
    return this._agent?.pendingInterceptors();
  }

  handleGetUser({user = userWithOneWorkspace, status = 200}: {user?: any; status?: number} = {}): ObservableApiMock {
    const response = status == 200 ? JSON.stringify(user) : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: "/cli/user", headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }

  handleGetProject({
    workspaceLogin,
    projectSlug,
    projectId = "project123",
    title = "Mock BI",
    status = 200
  }: {
    workspaceLogin: string;
    projectSlug: string;
    projectId?: string;
    title?: string;
    status?: number;
  }): ObservableApiMock {
    const response = status === 200 ? JSON.stringify({id: projectId, slug: projectSlug, title}) : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: `/cli/project/@${workspaceLogin}/${projectSlug}`, headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }

  handlePostProject({
    projectId,
    status = 200
  }: {
    projectId?: string;
    title?: string;
    slug?: string;
    workspaceId?: string;
    status?: number;
  } = {}): ObservableApiMock {
    const response =
      status == 200
        ? JSON.stringify({id: projectId, slug: "test-project", title: "Test Project", owner: {}, creator: {}})
        : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: "/cli/project", method: "POST", headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }

  handleUpdateProject({
    projectId = "project123",
    title,
    status = 200
  }: {
    projectId?: string;
    title?: string;
    status?: number;
  } = {}): ObservableApiMock {
    const response = status == 200 ? JSON.stringify({title, slug: "bi"}) : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: `/cli/project/${projectId}/edit`, method: "POST", headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }

  handlePostDeploy({
    projectId,
    deployId,
    status = 200
  }: {projectId?: string; deployId?: string; status?: number} = {}): ObservableApiMock {
    const response = status == 200 ? JSON.stringify({id: deployId}) : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: `/cli/project/${projectId}/deploy`, method: "POST", headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }

  handlePostDeployFile({
    deployId,
    status = 204,
    repeat = 1
  }: {deployId?: string; status?: number; repeat?: number} = {}): ObservableApiMock {
    const response = status == 204 ? "" : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) => {
      pool
        .intercept({path: `/cli/deploy/${deployId}/file`, method: "POST", headers: headersMatcher(headers)})
        .reply(status, response)
        .times(repeat);
    });
    return this;
  }

  handlePostDeployUploaded({deployId, status = 200}: {deployId?: string; status?: number} = {}): ObservableApiMock {
    const response =
      status == 200
        ? JSON.stringify({
            id: deployId,
            status: "uploaded",
            url: `${getObservableUiOrigin()}/@mock-user-ws/test-project`
          })
        : emptyErrorBody;
    const headers = authorizationHeader(status != 401);
    this._handlers.push((pool) =>
      pool
        .intercept({path: `/cli/deploy/${deployId}/uploaded`, method: "POST", headers: headersMatcher(headers)})
        .reply(status, response, {headers: {"content-type": "application/json"}})
    );
    return this;
  }
}

function authorizationHeader(valid: boolean) {
  return {authorization: valid ? `apikey ${validApiKey}` : `apikey ${invalidApiKey}`};
}

/** All headers in `expected` must be present and have the expected value.
 *
 * If `expected` contains an "undefined" value, then it asserts that the header
 * is not present in the actual headers. */
function headersMatcher(expected: Record<string, string>): (headers: Record<string, string>) => boolean {
  const lowercaseExpected = Object.fromEntries(Object.entries(expected).map(([key, val]) => [key.toLowerCase(), val]));
  return (actual) => {
    const lowercaseActual = Object.fromEntries(Object.entries(actual).map(([key, val]) => [key.toLowerCase(), val]));
    for (const [key, expected] of Object.entries(lowercaseExpected)) {
      if (lowercaseActual[key] !== expected) return false;
    }
    return true;
  };
}

const userBase = {
  id: "0000000000000000",
  login: "mock-user",
  name: "Mock User",
  tier: "public",
  has_workspace: false
};

const workspace1 = {
  id: "0000000000000001",
  login: "mock-user-ws",
  name: "Mock User's Workspace",
  tier: "pro",
  type: "team",
  role: "owner"
};

const workspace2 = {
  id: "0000000000000002",
  login: "mock-user-ws-2",
  name: "Mock User's Second Workspace",
  tier: "pro",
  type: "team",
  role: "owner"
};

export const userWithZeroWorkspaces = {
  ...userBase,
  workspaces: []
};

export const userWithOneWorkspace = {
  ...userBase,
  workspaces: [workspace1]
};

export const userWithTwoWorkspaces = {
  ...userBase,
  workspaces: [workspace1, workspace2]
};
