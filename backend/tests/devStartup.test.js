import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { developmentPort, inspectDevelopmentServices } from '../utils/devStartup.js';
import { DEV_WORKSPACE_HEADER, devWorkspaceId } from '../utils/devWorkspace.js';

const serve = async (t, handler, host) => {
  const server = createServer(handler);
  await new Promise(resolve => host ? server.listen(0, host, resolve) : server.listen(0, resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, service: { name: 'test', port: server.address().port, pathname: '/api/test' } };
};

test('development startup reuses a responding service from this workspace', async t => {
  let requests = 0;
  const { service } = await serve(t, (req, res) => {
    requests += 1;
    assert.equal(req.url, '/api/test');
    res.setHeader(DEV_WORKSPACE_HEADER, devWorkspaceId);
    res.end('ready');
  });
  const [state] = await inspectDevelopmentServices([service]);
  assert.equal(state.state, 'running');
  assert.ok(requests >= 1);
});

test('startup recognizes IPv4-only and IPv6-only loopback services without launching duplicates', async t => {
  for (const host of ['127.0.0.1', '::1']) {
    const { service } = await serve(t, (req, res) => {
      res.setHeader(DEV_WORKSPACE_HEADER, devWorkspaceId);
      res.end('ready');
    }, host);
    assert.equal((await inspectDevelopmentServices([service]))[0].state, 'running');
  }
});

test('startup refuses an occupied port belonging to a different app without stopping it', async t => {
  const { service, server } = await serve(t, (req, res) => {
    res.setHeader(DEV_WORKSPACE_HEADER, 'another-checkout');
    res.end('other application');
  });
  const [state] = await inspectDevelopmentServices([service]);
  assert.equal(state.state, 'blocked');
  assert.equal(server.listening, true);
  const response = await fetch(`http://localhost:${service.port}/`);
  assert.equal(await response.text(), 'other application');
});

test('startup treats a missing identity or a failed health response as blocked', async t => {
  for (const status of [200, 503]) {
    const { service } = await serve(t, (req, res) => {
      if (status === 503) res.setHeader(DEV_WORKSPACE_HEADER, devWorkspaceId);
      res.writeHead(status).end('not ready');
    });
    assert.equal((await inspectDevelopmentServices([service]))[0].state, 'blocked');
  }
});

test('startup bounds its check of an unresponsive occupied port', async t => {
  const { service, server } = await serve(t, () => {});
  const [state] = await inspectDevelopmentServices([service], { timeoutMS: 25 });
  assert.equal(state.state, 'blocked');
  assert.equal(server.listening, true);
});

test('startup identifies a released port as available without leaving a listener behind', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.equal((await inspectDevelopmentServices([{ port, pathname: '/' }]))[0].state, 'available');
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
  await new Promise(resolve => server.close(resolve));
});

test('startup rejects invalid or duplicate ports and unbounded probe timeouts', async () => {
  assert.equal(developmentPort(undefined, 5000), 5000);
  assert.equal(developmentPort('', 5010), 5010);
  assert.equal(developmentPort('5011', 5000), 5011);
  for (const value of ['0', '65536', '5000.5', 'http://localhost:5000', true, 5000]) {
    assert.throws(() => developmentPort(value, 5000));
  }
  for (const services of [[{ port: 0, pathname: '/' }], [{ port: 5000, pathname: '/' }, { port: 5000, pathname: '/' }]]) {
    await assert.rejects(inspectDevelopmentServices(services));
  }
  await assert.rejects(inspectDevelopmentServices([], { timeoutMS: 0 }));
  await assert.rejects(inspectDevelopmentServices([], { timeoutMS: 10001 }));
});
