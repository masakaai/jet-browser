export function createSerialExecutor() {
  let tail=Promise.resolve();
  return {
    run(task){const current=tail.then(task);tail=current.catch(()=>{});return current;},
    drain(){return tail;}
  };
}
