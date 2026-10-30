/** Retired startup API. The entry point registers workflow-tools.js only. */
export function registerSfdTools(){
  throw new Error('sfd_start cleanup/controller was removed; load the SFD skill and call sfd_compile_workflow');
}
