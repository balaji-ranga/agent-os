"""Export only allowlisted evidence. Never include configs, overrides or tokens."""
import pathlib,tarfile
base=pathlib.Path('/opt/flolah-digital-adoption/releases');e=base/'20261019-immediate-e';g=base/'20261019-immediate-g';c=base/'20261019-immediate-c'
files={
 'vps/service-tests.log':g/'linux-tests.log','vps/deployment.json':g/'deployment-verification.json',
 'vps/backend-connector.log':e/'backend-connector-tests.log','vps/backend-runner.log':e/'backend-runner-tests.log',
 'vps/frontend-build.log':e/'platform-build.log','vps/management-capacity.log':e/'management-capacity.log','vps/private-capacity.log':e/'private-capacity.log',
 'vps/help-publication.log':e/'help-publication.log','vps/help-verification.json':e/'help-verification.log',
 'models/final.json':e/'model-output/model-results.json','models/stability.json':e/'model-output/model-results-2048-repeat.json',
 'history/checker-700-token.json':e/'model-output/model-results-700-token-repeat.json','history/model-before-generic-fixes.json':c/'model-output/model-results-initial.json',
 'history/model-before-budget.json':e/'model-output/model-results-attempt1.json',
}
destination=g/'public-evidence.tar.gz'
with tarfile.open(destination,'w:gz') as archive:
 for name,path in files.items():
  if path.is_symlink() or not path.resolve().is_relative_to(base):raise ValueError('Unsafe evidence path')
  archive.add(path,arcname=name,recursive=False)
print(destination)
