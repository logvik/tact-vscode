const RevertStatement = {
  print: ({ path, print, node}: any) => //JSON.stringify(path)
  ['repeat (', node.count ,') ', path.call(print, 'body')] 
};

export default RevertStatement;
