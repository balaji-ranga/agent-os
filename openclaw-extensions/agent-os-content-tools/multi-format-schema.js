export const multiFormatSchema={type:'object',properties:{
  operation:{type:'string',enum:['generate','convert','ocr']},
  content_file:{description:'Existing authenticated-company Content Folder item id, relative_path, or unique filename. Prefer this to sending full file bytes.',anyOf:[{type:'string'},{type:'object',properties:{id:{type:'string'},relative_path:{type:'string'},filename:{type:'string'},kind:{type:'string',enum:['uploaded','generated']}},additionalProperties:false}]},
  relative_path:{type:'string',description:'Existing owner-scoped Content Folder reference'},
  media_uri:{type:'string',description:'Exact MEDIA line returned by an owner-scoped content tool'},
  text:{type:'string',description:'Plain text, Markdown or HTML source'},
  content_base64:{type:'string',description:'Base64 file content when no Content Folder reference exists'},
  input_format:{type:'string',enum:['txt','md','html','pdf','docx','doc','xlsx','xls','csv','png','jpg','jpeg','webp','tiff','bmp']},
  input_filename:{type:'string'},output_filename:{type:'string'},
  formatted_input:{type:'array',items:{type:'object',properties:{type:{type:'string',enum:['heading','paragraph','list','table']},text:{type:'string'},level:{type:'integer'},rows:{type:'array',items:{type:'array',items:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]}}}},required:['type'],additionalProperties:false}},
  output_format:{type:'string',enum:['pdf','docx','doc','xlsx','txt','html','png','jpg']},
  ocr:{type:'string',enum:['auto','force','off']},language:{type:'string',description:'eng by default; spa/fra/deu or a plus-separated combination'}
},required:['output_format'],additionalProperties:false};
